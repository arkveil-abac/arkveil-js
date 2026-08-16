import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import { ModuleRef } from "@nestjs/core";
// Import the BUILT output, not the sources: the DI regression this guards
// against lived only in the bundle (esbuild emits no design:paramtypes, so
// implicit constructor injection dies in the published package while the
// TypeScript sources look fine). `pnpm run test` builds first.
import { ArkveilModule, PermissionPointGuard } from "../dist/index.js";

describe("PermissionPointGuard DI (built output)", () => {
  it("gets reflector and arkveil injected when Nest instantiates it", async () => {
    const testingModule = await Test.createTestingModule({
      imports: [
        ArkveilModule.forRoot({
          serviceUrl: "http://127.0.0.1:9",
          apiKey: "test-key",
        }),
      ],
    }).compile();

    // Guards referenced by @UseGuards are instantiated as enhancers through
    // the module injector — ModuleRef.create() exercises the same path.
    const moduleRef = testingModule.get(ModuleRef, { strict: false });
    const guard = await moduleRef.create(PermissionPointGuard);

    expect((guard as any).reflector).toBeDefined();
    expect((guard as any).arkveil).toBeDefined();
  });
});
