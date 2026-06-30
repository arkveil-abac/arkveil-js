# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Arkveil is an ABAC (attribute-based access control) platform. This repo is the **JavaScript/TypeScript SDK monorepo** — a thin client that calls the hosted Arkveil service (`POST /api/{version}/abac/permissions/check`) to decide whether an action is allowed. It does **not** contain the permission engine itself.

pnpm + Turborepo monorepo (workspaces defined in `pnpm-workspace.yaml`). Three published packages under `packages/` plus runnable examples under `examples/`.

- **`arkveil`** (core, runtime-agnostic) — the `Arkveil` class, retry logic, and the typed-codes registry system.
- **`@arkveil/node`** — Express/Fastify middleware. Depends on core via `workspace:*`.
- **`@arkveil/nest`** — NestJS module, guard, and decorator. Depends on core via `workspace:*`.

## Commands

```bash
pnpm install                             # install (packageManager pins pnpm@10.13.1)
pnpm run build                           # build all packages (turbo, respects dep order)
pnpm run check-types                     # tsc --noEmit across packages that define it
pnpm run format                          # prettier --write **/*.{ts,tsx,md}
pnpm --filter arkveil run build          # build a single package (or: turbo run build --filter=arkveil)
pnpm --filter express-example exec tsc --noEmit   # typecheck the example
```

**Note:** there is **no test runner configured** — no test files exist and no `test` script is defined (wire up vitest if you add tests). `pnpm run lint` is a no-op (no package defines a `lint` script).

`pnpm run build` is wired so turbo's `build` `dependsOn` `^build` — **core builds before `node`/`nest`**. After changing core types, rebuild core (or run the top-level build) so the dependents typecheck against the new output.

pnpm uses an isolated (non-hoisted) `node_modules`, so every import must be a declared dependency — that's why the example declares `@arkveil/node` and `arkveil` as `workspace:*` deps. esbuild (via tsup) is whitelisted under `onlyBuiltDependencies` in `pnpm-workspace.yaml` so pnpm v10 runs its install script.

## Architecture

### Inheritance, not composition
`@arkveil/node`'s `ArkveilNodeClient` **extends** the core `Arkveil` class (and re-exports it as `Arkveil`). The core's `handleDenied()` throws by design; the Node subclass overrides it to send a 403. NestJS instead wraps the core class in a provider + guard rather than subclassing. So core logic (request building, `checkPermission`, retry) lives in one place and platform packages only add transport/denial behavior.

### Fail-closed
`checkPermission` never throws to the caller: network errors, timeouts, and non-OK responses are logged and return `{ granted: false }`. `fetchWithRetry` (core) retries `429`/`5xx`/network failures with exponential backoff + jitter; 4xx (except 429) are not retried. Preserve this fail-closed contract when touching the request path.

### Typed codes & attributes (the central design — read before editing types)
The core declares three **empty** registry interfaces — `ArkveilCodeRegistry`, `ArkveilUserRegistry`, `ArkveilContextRegistry` — and three conditional types (`ArkveilCode`, `ArkveilUser`, `ArkveilContext`) that resolve to the registered type **or fall back** to `string` / `Record<string, any>` when the registry is un-augmented. This fallback is what keeps untyped usage compiling; do not remove it.

Consumers run the external **`arkveil` CLI** (`arkveil generate typescript -o src/arkveil.generated.ts`) to emit a file that `declare module "arkveil"`-merges concrete codes/attributes into those registries. A side-effect import of that file then types `checkPermission`, the Node `permissionPoint(code)` middleware, and the NestJS `@PermissionPoint(code)` decorator everywhere. Generics (`Arkveil<TCode, TUser, TContext>`) thread the same types through for users who prefer passing them explicitly over global augmentation. See `examples/express-example/arkveil.generated.ts` for the generated shape. **The CLI is not part of this repo** — it ships separately, so the `arkveil generate` / `arkveil sdk info` commands referenced in the READMEs are not runnable from here.

### NestJS request extraction
`getRequestFromContext` handles HTTP, GraphQL, and WebSocket execution contexts. `@nestjs/graphql` is an **optional** peer dependency and is imported lazily only when a GraphQL context is seen, so the package stays importable in REST/WS-only apps.

### Build output
tsup emits dual ESM (`.js`) + CJS (`.cjs`) with matching `.d.ts`/`.d.cts`, mapped in each package's `exports`. tsup auto-externalizes anything in `dependencies`/`peerDependencies`, so core (`arkveil`) is **not** bundled into `node`/`nest` — they `require("arkveil")` at runtime, which is why the `workspace:*` dependency must resolve to a real published version (see below).

## Publishing (important)

One command from the repo root publishes all public packages:

```bash
pnpm run release    # = pnpm run build && pnpm -r publish
```

`pnpm -r publish` publishes in topological order (**`arkveil` first**, then `node`/`nest`), skips `private` packages (root + examples) and any version already on the registry, runs each package's `prepublishOnly`, and rewrites the `workspace:*` dep on `arkveil` to the concrete version (`0.1.0`) in the published tarball. Do **not** use `npm publish` — it leaves the literal `workspace:*`, producing an uninstallable package.

Notes:
- `release` builds all packages first because only `arkveil` has a `prepublishOnly` (`check-types && build`); `node`/`nest` don't self-build on publish.
- pnpm runs git cleanliness/branch checks before publishing; commit first, or append `--no-git-checks` for a dry/uncommitted run. Dry run: `pnpm -r publish --dry-run --no-git-checks`.
- First publish of `@arkveil/node` / `@arkveil/nest` requires the `@arkveil` npm scope to exist and you to be authenticated (`npm whoami`).
- Requires Node >= 18 (core uses global `fetch` / `AbortController`).
