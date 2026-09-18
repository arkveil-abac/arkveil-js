import { describe, it, expect, vi, afterEach } from "vitest";
import { Arkveil } from "../src/arkveil";
import {
  RUNTIME_REQUIRED,
  DATASOURCE_UNRESOLVED,
  DATASOURCE_ERROR,
  EVALUATION_ERROR,
  MODE_UNAVAILABLE,
} from "../src/index";
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

function makeClient(logger: Logger, onDenied?: Arkveil["onDenied"]) {
  return new Arkveil({
    serviceUrl: "http://api.test/",
    apiKey: "test-key",
    retryAttempts: 1,
    logger,
    onDenied,
  });
}

const request = { actionCode: "orders:read", user: { id: "u-1" }, context: {} };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkPermission — reason and mode", () => {
  it("exports the reasons a denial can carry", () => {
    expect(RUNTIME_REQUIRED).toBe("RUNTIME_REQUIRED");
    expect(DATASOURCE_UNRESOLVED).toBe("DATASOURCE_UNRESOLVED");
    expect(DATASOURCE_ERROR).toBe("DATASOURCE_ERROR");
    expect(EVALUATION_ERROR).toBe("EVALUATION_ERROR");
  });

  it("passes the server's reason and mode through on a denial", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          granted: false,
          reason: "DATASOURCE_UNRESOLVED",
          mode: "NORMAL",
        }),
      ),
    );

    const logger = makeLogger();
    const result = await makeClient(logger).checkPermission(request);

    expect(result).toEqual({
      granted: false,
      reason: "DATASOURCE_UNRESOLVED",
      mode: "NORMAL",
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("returns a grant served in a degraded mode as-is and flags it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ granted: true, mode: "MIRROR_STALE" })),
    );

    const logger = makeLogger();
    const result = await makeClient(logger).checkPermission(request);

    expect(result).toEqual({ granted: true, mode: "MIRROR_STALE" });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        `Permission check for action orders:read served in degraded mode "MIRROR_STALE"`,
      ),
    );
  });

  it("fails closed with mode UNAVAILABLE on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ message: "nope" }, 500)),
    );

    const logger = makeLogger();
    const result = await makeClient(logger).checkPermission(request);

    expect(result).toEqual({ granted: false, mode: MODE_UNAVAILABLE });
    expect(logger.error).toHaveBeenCalled();
  });

  it("fails closed with mode UNAVAILABLE on a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    const result = await makeClient(makeLogger()).checkPermission(request);

    expect(result).toEqual({ granted: false, mode: MODE_UNAVAILABLE });
  });
});

describe("handleDenied — the reason reaches onDenied", () => {
  it("hands the reason to the configured onDenied as its third argument", async () => {
    const onDenied = vi.fn();
    const client = makeClient(makeLogger(), onDenied);
    const req = { id: "r-1" };
    const res = {};

    await (client as any).handleDenied(
      req,
      res,
      undefined,
      undefined,
      "RUNTIME_REQUIRED",
    );

    expect(onDenied).toHaveBeenCalledWith(req, res, "RUNTIME_REQUIRED");
  });

  it("passes no reason for an ordinary policy deny", async () => {
    const onDenied = vi.fn();
    const client = makeClient(makeLogger(), onDenied);

    await (client as any).handleDenied({}, {}, undefined);

    expect(onDenied).toHaveBeenCalledWith({}, {}, undefined);
  });

  it("still throws without any handler", () => {
    const client = makeClient(makeLogger());

    expect(() =>
      (client as any).handleDenied({}, {}, undefined, undefined, "X"),
    ).toThrowError(/No custom onDenied handler/);
  });
});
