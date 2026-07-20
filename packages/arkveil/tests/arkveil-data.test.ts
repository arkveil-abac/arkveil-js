import { describe, it, expect, vi, afterEach } from "vitest";
import { Arkveil } from "../src/arkveil";
import type { Logger } from "../src/types/logger";

function makeLogger(): Logger {
  return { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeClient(logger: Logger) {
  // retryAttempts: 1 keeps failure tests fast (no backoff sleeps).
  return new Arkveil({
    serviceUrl: "http://api.test/",
    apiKey: "test-key",
    retryAttempts: 1,
    logger,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildReadCondition", () => {
  it("posts to /abac/conditions/read with the api key and normalized dataset code", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ readCondition: `"p"."amount" > 0`, mode: "NORMAL" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const logger = makeLogger();
    const result = await makeClient(logger).buildReadCondition({
      datasetCode: " Billing.Public.PAYMENTS ",
      user: { id: "u1" },
      context: { region: "EU" },
      alias: "p",
    });

    expect(result).toEqual({
      readCondition: `"p"."amount" > 0`,
      mode: "NORMAL",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://api.test/api/v1/abac/conditions/read");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(
      "test-key",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      datasetCode: "billing.public.payments",
      user: { id: "u1" },
      context: { region: "EU" },
      alias: "p",
    });
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("omits alias from the body when not provided", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ readCondition: "FALSE", mode: "NORMAL" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await makeClient(makeLogger()).buildReadCondition({
      datasetCode: "billing.public.payments",
      user: {},
      context: {},
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(init.body as string)).not.toHaveProperty("alias");
  });

  it("treats FALSE as a normal response, not an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ readCondition: "FALSE", mode: "NORMAL" }),
      ),
    );

    const logger = makeLogger();
    const result = await makeClient(logger).buildReadCondition({
      datasetCode: "billing.public.payments",
      user: {},
      context: {},
    });

    expect(result.readCondition).toBe("FALSE");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("passes unknown response fields through (additive contract)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          readCondition: "TRUE",
          mode: "NORMAL",
          future: "field",
        }),
      ),
    );

    const result = await makeClient(makeLogger()).buildReadCondition({
      datasetCode: "billing.public.payments",
      user: {},
      context: {},
    });

    expect((result as unknown as Record<string, unknown>).future).toBe("field");
  });

  it("flags a non-NORMAL mode in diagnostics while honoring the SQL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ readCondition: `"t"."x" = 1`, mode: "STALE_OPEN" }),
      ),
    );

    const logger = makeLogger();
    const result = await makeClient(logger).buildReadCondition({
      datasetCode: "billing.public.payments",
      user: {},
      context: {},
    });

    expect(result.readCondition).toBe(`"t"."x" = 1`);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`degraded mode "STALE_OPEN"`),
    );
  });

  it("fails closed (FALSE) on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ message: "boom" }, 400)),
    );

    const logger = makeLogger();
    const result = await makeClient(logger).buildReadCondition({
      datasetCode: "billing.public.payments",
      user: {},
      context: {},
    });

    expect(result).toEqual({ readCondition: "FALSE", mode: "UNAVAILABLE" });
    expect(logger.error).toHaveBeenCalled();
  });

  it("fails closed (FALSE) on a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );

    const result = await makeClient(makeLogger()).buildReadCondition({
      datasetCode: "billing.public.payments",
      user: {},
      context: {},
    });

    expect(result).toEqual({ readCondition: "FALSE", mode: "UNAVAILABLE" });
  });

  it("throws on a malformed dataset code without calling the server", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      makeClient(makeLogger()).buildReadCondition({
        datasetCode: "billing.payments",
        user: {},
        context: {},
      }),
    ).rejects.toThrowError(/exactly 3 segments/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("buildWriteChecks", () => {
  const okBody = { writeSql: "SELECT TRUE", invariantSql: [], mode: "NORMAL" };

  it("posts to /abac/conditions/write with ids stringified on the wire", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(okBody));
    vi.stubGlobal("fetch", fetchMock);

    await makeClient(makeLogger()).buildWriteChecks({
      datasetCode: "billing.public.payments",
      user: { id: "u1" },
      context: {},
      ids: [42, "7", 10n],
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://api.test/api/v1/abac/conditions/write");
    expect(JSON.parse(init.body as string).ids).toEqual(["42", "7", "10"]);
  });

  it("omits ids from the body when not provided", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ ...okBody, writeSql: `... IN ({{ids}})` }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await makeClient(makeLogger()).buildWriteChecks({
      datasetCode: "billing.public.payments",
      user: {},
      context: {},
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(init.body as string)).not.toHaveProperty("ids");
    expect(result.writeSql).toContain("{{ids}}");
  });

  it("wires invariantSql through untouched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ ...okBody, invariantSql: ["SELECT check_1()"] }),
      ),
    );

    const result = await makeClient(makeLogger()).buildWriteChecks({
      datasetCode: "billing.public.payments",
      user: {},
      context: {},
    });

    expect(result.invariantSql).toEqual(["SELECT check_1()"]);
  });

  it("surfaces METADATA_MISSING distinctly from a policy deny", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          writeSql: "SELECT FALSE",
          invariantSql: [],
          mode: "NORMAL",
          reason: "METADATA_MISSING",
        }),
      ),
    );

    const logger = makeLogger();
    const result = await makeClient(logger).buildWriteChecks({
      datasetCode: "billing.public.ghosts",
      user: {},
      context: {},
    });

    expect(result.reason).toBe("METADATA_MISSING");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("METADATA_MISSING"),
    );
  });

  it("fails closed (SELECT FALSE) on transport failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("timeout");
      }),
    );

    const logger = makeLogger();
    const result = await makeClient(logger).buildWriteChecks({
      datasetCode: "billing.public.payments",
      user: {},
      context: {},
      ids: ["1"],
    });

    expect(result).toEqual({
      writeSql: "SELECT FALSE",
      invariantSql: [],
      mode: "UNAVAILABLE",
    });
    expect(logger.error).toHaveBeenCalled();
  });

  it("throws on a malformed dataset code without calling the server", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      makeClient(makeLogger()).buildWriteChecks({
        datasetCode: "db.billing.public.payments",
        user: {},
        context: {},
      }),
    ).rejects.toThrowError(/exactly 3 segments/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
