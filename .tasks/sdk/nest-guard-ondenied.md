---
id: nest-guard-ondenied
phase: sdk
status: PENDING
depends_on: []
created: "2026-09-18T01:12:38Z"
updated: "2026-09-18T01:12:38Z"
claimed_by: null
claimed_at: null
---

# Nest guard ignores onDenied — decide how a NestJS app customizes a denial and reads its reason

## Description

Linear: <link>

`ArkveilModuleOptions extends ArkveilParams`, so `ArkveilModule.forRoot({ onDenied })` type-checks
and the module stores the handler in the `Arkveil` instance it provides (`src/arkveil.module.ts`).
The README documents it: the options table lists `onDenied` ("Custom handler for denied access")
and the "Custom Denied Handler" section shows `onDenied: (req, res) => res.status(403).json({...})`
under `forRoot`.

`PermissionPointGuard.canActivate` (`src/guards/permission-point.guard.ts`) never uses it: on
`granted: false` it logs a warning and throws
`ForbiddenException("You do not have permission to perform this action")`. `Arkveil.handleDenied`
— the core method that dispatches to `onDenied` — is not on the guard's path at all. So in NestJS
the option is a no-op, while `@arkveil/node` honors it (`permissionPoint` → `handleDenied` →
`onDenied`, `packages/node/src/client.ts`).

Since `permission-check-reason-mode` (commit 624c9ae) a denial carries the server's `reason`
(`RUNTIME_REQUIRED`, `DATASOURCE_UNRESOLVED`, `DATASOURCE_ERROR`, `EVALUATION_ERROR`,
`ATTRIBUTE_INCOMPATIBLE`) and `onDenied(req, res, reason?)` receives it as the third argument. A
NestJS application therefore has no programmatic access to the reason: it only appears in the
guard's log line. The default 403 body deliberately does not carry it.

Decide and implement one of:

1. **Honor `onDenied` in the guard.** For HTTP contexts get `res` via
   `context.switchToHttp().getResponse()`, call `onDenied(req, res, reason)`, and stop the request
   without Nest sending a second response on top of the handler's (a guard returning `false` makes
   Nest throw its own 403 — "headers already sent" if the handler replied). GraphQL and WS contexts
   have no `res` in the same sense — define what happens there (throw as today?).
2. **Nest-idiomatic: throw, don't call back.** The guard throws a dedicated
   `ArkveilForbiddenException extends ForbiddenException` carrying `actionCode` and `reason` as
   properties (not in the HTTP body); applications customize the response with an exception filter
   (`@Catch(ArkveilForbiddenException)`). Drop `onDenied` from `ArkveilModuleOptions`
   (`Omit<ArkveilParams, "onDenied">`) and replace the README section with the filter recipe.
   Type-level break for anyone passing `onDenied` to `forRoot`; no runtime change, it never ran.
3. **Docs only.** Keep the behavior and state in the README that `onDenied` has no effect in NestJS.

Option 2 fits how guards and filters divide the work in Nest and keeps one denial path; option 1
keeps parity with `@arkveil/node`. Either way the reason must become reachable by the app.

## Acceptance criteria

- [ ] The Nest package and its README agree on how a denial is customized.
- [ ] A NestJS app can read the denial `reason` (handler argument or exception property).
- [ ] The default 403 response body still does not expose the reason.
- [ ] `tests/guard-reason.test.ts` (runs on the built output) covers the chosen behavior for a
      reasoned denial and a plain one; the DI test stays green.
- [ ] `sdk/nest.mdx` on the landing follows the README.

## Notes

References: `packages/nest/src/guards/permission-point.guard.ts`, `packages/nest/src/arkveil.module.ts`,
`packages/nest/README.md` ("Custom Denied Handler", "Denial reasons"); core
`packages/arkveil/src/arkveil.ts` — `handleDenied(req, res, next, onDenied?, reason?)`,
`PermissionCheckResponse { granted, reason?, mode }`; working reference
`packages/node/src/client.ts` (`permissionPoint`, `handleDenied` override).
Noticed on 2026-09-17 while wiring the reason into `onDenied`.
