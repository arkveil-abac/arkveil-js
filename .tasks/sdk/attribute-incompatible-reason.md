---
id: attribute-incompatible-reason
phase: sdk
status: DONE
depends_on: []
created: "2026-09-18T00:47:28Z"
updated: "2026-09-18T00:50:50Z"
claimed_by: null
claimed_at: null
---

# Report reason ATTRIBUTE_INCOMPATIBLE on data conditions

## Description

The kernel and the runtime now report `reason: "ATTRIBUTE_INCOMPATIBLE"` when an evaluation read a
payload value of the wrong type for its attribute schema (`"u-42"` for a `uuid` `user.id`, `"abc"`
for an `integer`). The value is evaluated as absent — decisions and SQL are unchanged — but the fold
is no longer silent. It appears on `permissions/check` denials and on `conditions/read` (new
`reason` field there), `conditions/touch` and `conditions/write`, on the condition endpoints even
when the SQL still admits rows. Spec: backend `docs/engineering/typescript-sdk-2026-09-16-changes.md`.

## Acceptance criteria

- [x] `ATTRIBUTE_INCOMPATIBLE` exported beside `METADATA_MISSING` from `arkveil`, `@arkveil/node` and `@arkveil/nest`.
- [x] `ReadConditionResponse.reason` JSDoc says the server sets it too, possibly next to a non-`FALSE` condition.
- [x] Read, write and touch log the reason distinctly (a warning naming the dataset), and apply the response exactly as returned — never widen, retry or reinterpret.
- [x] Tests: a read/write/touch response carrying the reason with non-deny SQL passes through unchanged and logs the warning; the constant is exported from the built packages.
- [x] README: the reason documented next to `METADATA_MISSING`.

## Notes

### Implementation (2026-09-17)

`ATTRIBUTE_INCOMPATIBLE` lives beside `METADATA_MISSING` in `packages/arkveil/src/data-conditions.ts`
and is re-exported by all three packages. `Arkveil.reportConfigurationGap` (core) logs it as a
warning naming the dataset for read, write and touch; the response is applied as returned.
Tests in `packages/arkveil/tests/arkveil-data.test.ts` (pass-through + warning for the three calls)
and `packages/nest/tests/guard-di.test.ts` (the constant on the built output). README: the reason
documented in "Fail-closed behavior" next to `mode`.
