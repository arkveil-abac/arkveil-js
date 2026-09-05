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

  it("fails closed (FALSE) when the response omits readCondition", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ mode: "NORMAL" })),
    );

    const logger = makeLogger();
    const result = await makeClient(logger).buildReadCondition({
      datasetCode: "billing.public.payments",
      user: {},
      context: {},
    });

    expect(result).toEqual({
      readCondition: "FALSE",
      mode: "NORMAL",
      reason: "CONTRACT_VIOLATION",
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("missing readCondition"),
    );
  });
});

describe("buildWriteChecks — request shape", () => {
  const updateBody = {
    touchSql: `SELECT NOT EXISTS (SELECT 1 FROM p WHERE id IN ('42') AND locked)`,
    resultSql: `SELECT NOT EXISTS (SELECT 1 FROM p WHERE id IN ('42') AND amount > 100)`,
    mode: "NORMAL",
  };

  it("posts operation and stringified ids to /abac/conditions/write", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(updateBody));
    vi.stubGlobal("fetch", fetchMock);

    await makeClient(makeLogger()).buildWriteChecks({
      datasetCode: " Billing.Public.PAYMENTS ",
      user: { id: "u1" },
      context: {},
      operation: "UPDATE",
      ids: [42, "7", 10n],
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://api.test/api/v1/abac/conditions/write");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(
      "test-key",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      datasetCode: "billing.public.payments",
      user: { id: "u1" },
      context: {},
      operation: "UPDATE",
      ids: ["42", "7", "10"],
    });
  });

  it("sends no ids for CREATE — they do not exist until after the insert", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        resultSql: `SELECT NOT EXISTS (SELECT 1 FROM p WHERE id IN ({{ids}}) AND amount > 100)`,
        mode: "NORMAL",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await makeClient(makeLogger()).buildWriteChecks({
      datasetCode: "billing.public.payments",
      user: {},
      context: {},
      operation: "CREATE",
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.operation).toBe("CREATE");
    expect(body).not.toHaveProperty("ids");
  });

  it("rejects ids sent with CREATE without calling the server", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      makeClient(makeLogger()).buildWriteChecks({
        datasetCode: "billing.public.payments",
        user: {},
        context: {},
        operation: "CREATE",
        ids: ["1"],
      }),
    ).rejects.toThrowError(/ids must not be sent with CREATE/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["UPDATE", "DELETE"] as const)(
    "rejects %s with no ids — the checks are rendered over named rows",
    async (operation) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        makeClient(makeLogger()).buildWriteChecks({
          datasetCode: "billing.public.payments",
          user: {},
          context: {},
          operation,
        }),
      ).rejects.toThrowError(new RegExp(`ids are required for ${operation}`));
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("rejects an unknown operation", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      makeClient(makeLogger()).buildWriteChecks({
        datasetCode: "billing.public.payments",
        user: {},
        context: {},
        // READ is not a mutation; the server answers 400.
        operation: "READ" as unknown as "UPDATE",
        ids: ["1"],
      }),
    ).rejects.toThrowError(/operation must be one of/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["UPDATE", "DELETE"] as const)(
    "treats an empty %s id list as a client-side no-op (no request)",
    async (operation) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const result = await makeClient(makeLogger()).buildWriteChecks({
        datasetCode: "billing.public.payments",
        user: {},
        context: {},
        operation,
        ids: [],
      });

      expect(result).toEqual({ mode: "NO_OP" });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("throws on a malformed dataset code without calling the server", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      makeClient(makeLogger()).buildWriteChecks({
        datasetCode: "db.billing.public.payments",
        user: {},
        context: {},
        operation: "CREATE",
      }),
    ).rejects.toThrowError(/exactly 3 segments/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("buildWriteChecks — the timing contract", () => {
  const CREATE_RESULT = `SELECT NOT EXISTS (SELECT 1 FROM p WHERE id IN ({{ids}}) AND amount > 100)`;
  const TOUCH = `SELECT NOT EXISTS (SELECT 1 FROM p WHERE id IN ('42') AND locked)`;
  const RESULT = `SELECT NOT EXISTS (SELECT 1 FROM p WHERE id IN ('42') AND amount > 100)`;

  it("CREATE has a post-state check only, carrying the {{ids}} template", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ resultSql: CREATE_RESULT, mode: "NORMAL" }),
      ),
    );

    const result = await makeClient(makeLogger()).buildWriteChecks({
      datasetCode: "billing.public.payments",
      user: {},
      context: {},
      operation: "CREATE",
    });

    expect(result.touchSql).toBeUndefined();
    expect(result.resultSql).toBe(CREATE_RESULT);
    expect(result.reason).toBeUndefined();
  });

  it("UPDATE has both checks, over the same ids and with no template", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ touchSql: TOUCH, resultSql: RESULT, mode: "NORMAL" }),
      ),
    );

    const result = await makeClient(makeLogger()).buildWriteChecks({
      datasetCode: "billing.public.payments",
      user: {},
      context: {},
      operation: "UPDATE",
      ids: ["42"],
    });

    expect(result.touchSql).toBe(TOUCH);
    expect(result.resultSql).toBe(RESULT);
  });

  it("DELETE has a pre-state check only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ touchSql: TOUCH, mode: "NORMAL" })),
    );

    const result = await makeClient(makeLogger()).buildWriteChecks({
      datasetCode: "billing.public.payments",
      user: {},
      context: {},
      operation: "DELETE",
      ids: ["42"],
    });

    expect(result.touchSql).toBe(TOUCH);
    expect(result.resultSql).toBeUndefined();
  });

  it("drops a phase the operation does not have rather than handing it over", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ touchSql: TOUCH, resultSql: RESULT, mode: "NORMAL" }),
      ),
    );

    const logger = makeLogger();
    const result = await makeClient(logger).buildWriteChecks({
      datasetCode: "billing.public.payments",
      user: {},
      context: {},
      operation: "DELETE",
      ids: ["42"],
    });

    expect(result.resultSql).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("no phase for"),
    );
  });

  it("passes unknown response fields through (additive contract)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ touchSql: TOUCH, mode: "NORMAL", future: "field" }),
      ),
    );

    const result = await makeClient(makeLogger()).buildWriteChecks({
      datasetCode: "billing.public.payments",
      user: {},
      context: {},
      operation: "DELETE",
      ids: ["42"],
    });

    expect((result as unknown as Record<string, unknown>).future).toBe("field");
  });

  it("flags a non-NORMAL mode in diagnostics while honoring the SQL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ touchSql: TOUCH, mode: "STALE_OPEN" })),
    );

    const logger = makeLogger();
    const result = await makeClient(logger).buildWriteChecks({
      datasetCode: "billing.public.payments",
      user: {},
      context: {},
      operation: "DELETE",
      ids: ["42"],
    });

    expect(result.touchSql).toBe(TOUCH);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`degraded mode "STALE_OPEN"`),
    );
  });
});

describe("buildWriteChecks — fail-closed", () => {
  const cases = [
    {
      operation: "CREATE" as const,
      ids: undefined,
      denied: { resultSql: "SELECT FALSE", mode: "UNAVAILABLE" },
    },
    {
      operation: "UPDATE" as const,
      ids: ["42"],
      denied: {
        touchSql: "SELECT FALSE",
        resultSql: "SELECT FALSE",
        mode: "UNAVAILABLE",
      },
    },
    {
      operation: "DELETE" as const,
      ids: ["42"],
      denied: { touchSql: "SELECT FALSE", mode: "UNAVAILABLE" },
    },
  ];

  it.each(cases)(
    "denies $operation with SELECT FALSE in every field it has on transport failure",
    async ({ operation, ids, denied }) => {
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
        operation,
        ids,
      });

      expect(result).toEqual(denied);
      expect(logger.error).toHaveBeenCalled();
    },
  );

  it.each(cases)(
    "denies $operation on a non-OK response",
    async ({ operation, ids, denied }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse({ message: "boom" }, 500)),
      );

      const result = await makeClient(makeLogger()).buildWriteChecks({
        datasetCode: "billing.public.payments",
        user: {},
        context: {},
        operation,
        ids,
      });

      expect(result).toEqual(denied);
    },
  );

  it("denies when the response omits a field the operation requires", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ resultSql: "SELECT TRUE", mode: "NORMAL" }),
      ),
    );

    const logger = makeLogger();
    const result = await makeClient(logger).buildWriteChecks({
      datasetCode: "billing.public.payments",
      user: {},
      context: {},
      operation: "UPDATE",
      ids: ["42"],
    });

    expect(result).toEqual({
      touchSql: "SELECT FALSE",
      resultSql: "SELECT FALSE",
      mode: "NORMAL",
      reason: "CONTRACT_VIOLATION",
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("missing touchSql"),
    );
  });

  it("denies an UPDATE whose checks still carry an {{ids}} template", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          touchSql: `SELECT ... IN ({{ids}})`,
          resultSql: "SELECT TRUE",
          mode: "NORMAL",
        }),
      ),
    );

    const logger = makeLogger();
    const result = await makeClient(logger).buildWriteChecks({
      datasetCode: "billing.public.payments",
      user: {},
      context: {},
      operation: "UPDATE",
      ids: ["42"],
    });

    expect(result.touchSql).toBe("SELECT FALSE");
    expect(result.resultSql).toBe("SELECT FALSE");
    expect(result.reason).toBe("CONTRACT_VIOLATION");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("inlined server-side"),
    );
  });

  it("denies a CREATE whose resultSql carries no template to fill", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ resultSql: "SELECT TRUE", mode: "NORMAL" }),
      ),
    );

    const logger = makeLogger();
    const result = await makeClient(logger).buildWriteChecks({
      datasetCode: "billing.public.payments",
      user: {},
      context: {},
      operation: "CREATE",
    });

    expect(result).toEqual({
      resultSql: "SELECT FALSE",
      mode: "NORMAL",
      reason: "CONTRACT_VIOLATION",
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("no {{ids}} template"),
    );
  });

  it("surfaces METADATA_MISSING distinctly from a policy deny", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          touchSql: "SELECT FALSE",
          resultSql: "SELECT FALSE",
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
      operation: "UPDATE",
      ids: ["42"],
    });

    expect(result.reason).toBe("METADATA_MISSING");
    expect(result.touchSql).toBe("SELECT FALSE");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("METADATA_MISSING"),
    );
  });

  it("does not mistake an unregistered CREATE dataset for a contract violation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          resultSql: "SELECT FALSE",
          mode: "NORMAL",
          reason: "METADATA_MISSING",
        }),
      ),
    );

    const result = await makeClient(makeLogger()).buildWriteChecks({
      datasetCode: "billing.public.ghosts",
      user: {},
      context: {},
      operation: "CREATE",
    });

    expect(result.reason).toBe("METADATA_MISSING");
  });
});

describe("buildTouchCondition", () => {
  it("posts the operation and alias to /abac/conditions/touch", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ touchCondition: `"p"."owner_id" = 'u1'`, mode: "NORMAL" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await makeClient(makeLogger()).buildTouchCondition({
      datasetCode: " Billing.Public.PAYMENTS ",
      user: { id: "u1" },
      context: {},
      alias: "p",
      operation: "UPDATE",
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://api.test/api/v1/abac/conditions/touch");
    expect(JSON.parse(init.body as string)).toEqual({
      datasetCode: "billing.public.payments",
      user: { id: "u1" },
      context: {},
      operation: "UPDATE",
      alias: "p",
    });
    expect(result.touchCondition).toBe(`"p"."owner_id" = 'u1'`);
  });

  it("rejects CREATE — there is no WHERE clause to compose into", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      makeClient(makeLogger()).buildTouchCondition({
        datasetCode: "billing.public.payments",
        user: {},
        context: {},
        operation: "CREATE" as unknown as "UPDATE",
      }),
    ).rejects.toThrowError(/operation must be one of/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats FALSE as a normal response (empty touch union ⇒ zero rows)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ touchCondition: "FALSE", mode: "NORMAL" }),
      ),
    );

    const logger = makeLogger();
    const result = await makeClient(logger).buildTouchCondition({
      datasetCode: "billing.public.payments",
      user: {},
      context: {},
      operation: "DELETE",
    });

    expect(result.touchCondition).toBe("FALSE");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("fails closed (FALSE) on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ message: "boom" }, 503)),
    );

    const logger = makeLogger();
    const result = await makeClient(logger).buildTouchCondition({
      datasetCode: "billing.public.payments",
      user: {},
      context: {},
      operation: "UPDATE",
    });

    expect(result).toEqual({ touchCondition: "FALSE", mode: "UNAVAILABLE" });
    expect(logger.error).toHaveBeenCalled();
  });

  it("denies when the response omits touchCondition", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ mode: "NORMAL" })),
    );

    const result = await makeClient(makeLogger()).buildTouchCondition({
      datasetCode: "billing.public.payments",
      user: {},
      context: {},
      operation: "UPDATE",
    });

    expect(result).toEqual({
      touchCondition: "FALSE",
      mode: "NORMAL",
      reason: "CONTRACT_VIOLATION",
    });
  });

  it("surfaces METADATA_MISSING distinctly from a policy deny", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          touchCondition: "FALSE",
          mode: "NORMAL",
          reason: "METADATA_MISSING",
        }),
      ),
    );

    const logger = makeLogger();
    await makeClient(logger).buildTouchCondition({
      datasetCode: "billing.public.ghosts",
      user: {},
      context: {},
      operation: "DELETE",
    });

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("METADATA_MISSING"),
    );
  });
});
