import "reflect-metadata";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForbiddenException, Logger } from "@nestjs/common";
// Built output, like guard-di.test.ts: the guard ships bundled, so its logging
// is asserted on what the package actually publishes.
import { PermissionPointGuard } from "../dist/index.js";

function httpContext(request: unknown) {
  return {
    getType: () => "http",
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as any;
}

function guardWith(response: Record<string, unknown>) {
  const reflector = { getAllAndOverride: () => "orders:read" } as any;
  const arkveil = {
    buildPermissionRequest: vi.fn(async () => ({
      actionCode: "orders:read",
      user: {},
      context: {},
    })),
    checkPermission: vi.fn(async () => response),
  } as any;
  return new PermissionPointGuard(reflector, arkveil);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PermissionPointGuard — denial reasons (built output)", () => {
  it("logs a reasoned denial distinctly and still throws 403", async () => {
    const warn = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => {});
    const guard = guardWith({
      granted: false,
      reason: "DATASOURCE_UNRESOLVED",
      mode: "NORMAL",
    });

    await expect(guard.canActivate(httpContext({}))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "Access denied to action orders:read with reason DATASOURCE_UNRESOLVED",
      ),
    );
  });

  it("logs a plain policy deny without a reason", async () => {
    const warn = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => {});
    const guard = guardWith({ granted: false, mode: "NORMAL" });

    await expect(guard.canActivate(httpContext({}))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(warn).toHaveBeenCalledWith(
      "[Arkveil] Access denied to action orders:read",
    );
  });

  it("lets a grant through", async () => {
    const guard = guardWith({ granted: true, mode: "NORMAL" });

    await expect(guard.canActivate(httpContext({}))).resolves.toBe(true);
  });
});
