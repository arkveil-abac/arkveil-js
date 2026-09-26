import { describe, it, expect, vi, afterEach } from "vitest";
import { ArkveilNodeClient } from "../src/client";
import {
  ATTRIBUTE_INCOMPATIBLE,
  DATASOURCE_UNRESOLVED,
  METADATA_MISSING,
  RUNTIME_REQUIRED,
} from "../index";

type Logger = NonNullable<
  ConstructorParameters<typeof ArkveilNodeClient>[0]["logger"]
>;

function makeLogger(): Logger {
  return { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function stubCheck(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
}

function expressResponse() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

function makeClient(
  logger: Logger,
  onDenied?: (req: any, res: any, reason?: string) => void,
) {
  return new ArkveilNodeClient({
    serviceUrl: "http://api.test",
    apiKey: "test-key",
    retryAttempts: 1,
    logger,
    getUserAttributes: (req) => req.user,
    onDenied,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("permissionPoint middleware", () => {
  it("re-exports the reason constants", () => {
    expect(METADATA_MISSING).toBe("METADATA_MISSING");
    expect(ATTRIBUTE_INCOMPATIBLE).toBe("ATTRIBUTE_INCOMPATIBLE");
    expect(RUNTIME_REQUIRED).toBe("RUNTIME_REQUIRED");
    expect(DATASOURCE_UNRESOLVED).toBe("DATASOURCE_UNRESOLVED");
  });

  it("calls next on a grant", async () => {
    stubCheck({ granted: true, mode: "NORMAL" });
    const logger = makeLogger();
    const next = vi.fn();

    await makeClient(logger).permissionPoint("orders:read")(
      { user: { id: "u-1" } },
      expressResponse(),
      next,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("hands a reasoned denial to onDenied with the reason and logs it distinctly", async () => {
    stubCheck({
      granted: false,
      reason: "DATASOURCE_UNRESOLVED",
      mode: "NORMAL",
    });
    const logger = makeLogger();
    const onDenied = vi.fn();
    const next = vi.fn();
    const req = { user: { id: "u-1" } };
    const res = expressResponse();

    await makeClient(logger, onDenied).permissionPoint("orders:read")(
      req,
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(onDenied).toHaveBeenCalledWith(req, res, "DATASOURCE_UNRESOLVED");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "Access denied to action orders:read with reason DATASOURCE_UNRESOLVED",
      ),
    );
  });

  it("logs a plain policy deny without a reason", async () => {
    stubCheck({ granted: false, mode: "NORMAL" });
    const logger = makeLogger();
    const onDenied = vi.fn();

    await makeClient(logger, onDenied).permissionPoint("orders:read")(
      { user: {} },
      expressResponse(),
      vi.fn(),
    );

    expect(onDenied).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "[Arkveil] Access denied to action orders:read",
    );
  });

  it("keeps the server reason out of the default 403 body", async () => {
    stubCheck({ granted: false, reason: "RUNTIME_REQUIRED", mode: "NORMAL" });
    const res = expressResponse();

    await makeClient(makeLogger()).permissionPoint("orders:read")(
      { user: {} },
      res,
      vi.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "Access denied",
      reason: "You do not have permission to perform this action",
    });
  });
});
