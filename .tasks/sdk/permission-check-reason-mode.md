---
id: permission-check-reason-mode
phase: sdk
status: DONE
depends_on: []
created: "2026-09-18T00:47:29Z"
updated: "2026-09-18T00:54:09Z"
claimed_by: null
claimed_at: null
---

# checkPermission surfaces the denial reason and the serving mode

## Description

`PermissionCheckResponse` declares only `granted`, and the NestJS guard and the Node middleware act
on that flag alone, so the `reason` the kernel and the runtime put on a denial —
`DATASOURCE_UNRESOLVED`, `DATASOURCE_ERROR`, `RUNTIME_REQUIRED`, `EVALUATION_ERROR`,
`ATTRIBUTE_INCOMPATIBLE` — never reaches an application, and neither does `mode` (`MIRROR_STALE` on
a grant served past the sidecar's staleness bound). An infrastructure incident is indistinguishable
from a policy denial in the caller's logs, error handling and audit. `ArkveilParams.onDenied`
already declares a third `reason?` argument that is never filled. Ruled an SDK task on 2026-09-16
(backend tracker entry "TS SDK `checkPermission` drops the denial `reason` (and `mode`)").

## Acceptance criteria

- [x] `PermissionCheckResponse` carries `reason?` and `mode`; the fail-closed fallback carries `mode: "UNAVAILABLE"` like the data methods.
- [x] `handleDenied` passes the server reason to `onDenied(req, res, reason)` in core and in the Node override; the 403 body stays as it is (no server reason leaks to HTTP clients).
- [x] The Node middleware and the NestJS guard log a denial that carries a reason distinctly from a plain deny; a non-`NORMAL` `mode` is flagged like on the data methods.
- [x] Reason constants exported beside `METADATA_MISSING`.
- [x] Fail-closed handling unchanged: a denial stays a denial. Tests for core, node (vitest added) and the guard; READMEs updated.

## Notes

### Implementation (2026-09-17)

- Core (`packages/arkveil/src/arkveil.ts`): `PermissionCheckResponse { granted, reason?, mode }`;
  `RUNTIME_REQUIRED`, `DATASOURCE_UNRESOLVED`, `DATASOURCE_ERROR`, `EVALUATION_ERROR` exported
  beside the data-side reasons; `checkPermission` flags a non-`NORMAL` mode and falls back to
  `{ granted: false, mode: "UNAVAILABLE" }`; `handleDenied(req, res, next, onDenied?, reason?)`
  hands the reason to the custom handler.
- Node (`packages/node/src/client.ts`): `permissionPoint` logs a reasoned denial distinctly and
  passes the reason to `handleDenied`; the default 403 body is unchanged. vitest added to the
  package (`tests/permission-point.test.ts`).
- Nest (`packages/nest/src/guards/permission-point.guard.ts`): distinct warning, same
  `ForbiddenException`. `tests/guard-reason.test.ts` runs against the built output.
- `scripts/nest-smoke/stub-kernel.mjs` answers with `mode: "NORMAL"` like the real servers.
- READMEs: reason table and `mode` in `arkveil`, `onDenied` third argument in `@arkveil/node`,
  "Denial reasons" in `@arkveil/nest`.

Follow-up noticed, not done here: `ArkveilModule.forRoot({ onDenied })` is accepted but the
NestJS guard never calls it — it always throws `ForbiddenException` (the README's "Custom Denied
Handler" section promises otherwise).
