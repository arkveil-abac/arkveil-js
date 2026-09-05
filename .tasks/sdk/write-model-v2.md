---
id: write-model-v2
phase: sdk
status: DONE
depends_on: []
created: "2026-09-05T16:11:51Z"
updated: "2026-09-05T16:26:19Z"
claimed_by: null
claimed_at: null
---

# Adopt the final write-model contract (TOUCH/RESULT, named-ids checks, conditions/touch)

## Description

The backend write-model v2 is **SHIPPED and live**: data policies are READ / TOUCH / RESULT, write checks are per-operation over named ids, `invariantSql` is gone, and a new `conditions/touch` endpoint serves bulk mutations by predicate.

_Naming note:_ the pre-state type was briefly named `GATE` in an earlier draft of this task; the backend renamed it `TOUCH` before any consumer shipped — same semantics, **TOUCH supersedes GATE everywhere**.

The full spec is pasted below verbatim from the backend repo (`docs/engineering/typescript-sdk-2026-08-30-changes.md`); deeper references there: `docs/engineering/datasets/data-features-typescript-sdk.md` §4 (contract) and `docs/model/write-model.md` (model).

**Current production effect, which is why this is urgent:** the SDK as released today sends the old request shape, so every write check it makes answers `400` — supervision is dead until this task ships. That is fail closed (denied writes, never over-permissive), but supervised writes do not work at all.

One contract rule to implement explicitly: **a response field the operation requires that is missing is a contract violation — deny, never proceed unchecked** (e.g. an `UPDATE` response without `touchSql`). Absent fields mean "this operation has no such phase" only where the timing table says so.

## Acceptance criteria

- [x] `WriteChecksRequest`/`WriteChecksResponse` per the spec: required `operation`; `ids` required non-empty for `UPDATE`/`DELETE` (absent for `CREATE`); `touchSql`/`resultSql`; `invariantSql` dropped from types and parsers.
- [x] CREATE path **replaced** (not removed): after insert, substitute the inserted ids into the `{{ids}}` template in `resultSql` and execute; roll back on false. `substituteIds` is used on this path only.
- [x] `UPDATE` runs both checks over the same ids; `DELETE` runs `touchSql` only; empty target set is a client-side no-op (no request).
- [x] Missing-expected-field and unexpected-template states deny; `reason` surfaced distinctly from a policy deny.
- [x] `conditions/touch` client + the two bulk recipes: `DELETE` = compose the touch condition into `WHERE` (complete); `UPDATE` = compose + `RETURNING` ids + execute `resultSql` ONLY (never `touchSql` post-hoc), same transaction.
- [x] Tests updated: timing, rollback, fail-closed table, bulk recipes.

## Notes

### Implementation (2026-09-05)

Core (`packages/arkveil/src/data-conditions.ts`, `arkveil.ts`):

- `WriteChecksRequest` now carries a required `operation`; `prepareWriteChecksIds`
  enforces the id rules (absent for CREATE, required for UPDATE/DELETE) and throws on
  the shapes the server answers 400 to. `WriteChecksResponse` is `touchSql?`/`resultSql?`;
  `invariantSql` is gone from the types, the parser, and the fail-closed fallbacks.
- `applyWriteChecksContract` holds each response to its operation's phases: a missing
  required field, an `{{ids}}` template where ids should have been inlined, and a CREATE
  `resultSql` with no template all deny with `reason: "CONTRACT_VIOLATION"`; a phase the
  operation does not have is dropped rather than handed over. `METADATA_MISSING` keeps its
  own distinct log line (both go through `reportConfigurationGap`).
- `resolveCreateResultSql(response, insertedIds)` completes the CREATE path — it wraps
  `substituteIds` (the only caller of it now) and returns `SELECT FALSE` whenever the
  response cannot be completed.
- `buildTouchCondition` posts `conditions/touch` for bulk `UPDATE`/`DELETE`; `CREATE`
  throws client-side. `buildReadCondition`/`buildTouchCondition` also deny on a missing
  condition field.
- Empty `ids` on UPDATE/DELETE: no request at all, `{ mode: "NO_OP" }` (`MODE_NO_OP`).

Tests: `tests/arkveil-data.test.ts` (request shape, timing contract, fail-closed table),
`tests/write-recipes.test.ts` (ordering + rollback against a fake transaction, and both
bulk recipes — the UPDATE one asserts `touchSql` is never executed post-hoc),
`tests/data-conditions.test.ts` (helper units). 77 tests pass; `pnpm run build` and
`check-types` are clean across the workspace.

Docs: core README's data section rewritten (READ/TOUCH/RESULT table, timing table, CREATE
path, both bulk recipes, fail-closed list); node/nest READMEs and CLAUDE.md updated.

Not done (out of scope, no consumer in this repo): `examples/express-example` uses only
`permissionPoint`, so it needed no change.

### Spec (verbatim) — TypeScript SDK changes, 2026-08-30

> Audience: the TypeScript SDK developer and coding agents working in the SDK repo. This doc supersedes the unshipped 2026-08-23/29 notes and describes the final contract in one pass; sections are self-contained. The model behind it is in the backend repo at `docs/model/write-model.md`; the full contract reference is `docs/engineering/datasets/data-features-typescript-sdk.md` §4.

#### The data-policy model: READ, TOUCH, RESULT

The v1 `WRITE` type is renamed `TOUCH` and narrowed to its honest role; `RESULT` is new. For the SDK the types matter through the checks they produce:

| Type   | Governs                                  | Judged                                |
| ------ | ---------------------------------------- | ------------------------------------- |
| READ   | which rows a user sees                   | at read time                          |
| TOUCH  | which existing rows a mutation may touch | before the mutation, on current state |
| RESULT | the state a mutation may leave rows in   | after the mutation, same transaction  |

TOUCH and RESULT policies declare the operations they govern (TOUCH ⊆ {UPDATE, DELETE}, RESULT ⊆ {CREATE, UPDATE}); every operation has its own union of grants, combined independently, and a mutation whose union has no applicable policy is denied whole.

#### Breaking: the write-check contract

`POST /api/v1/abac/conditions/write` — one request per mutation over named rows:

```ts
type WriteChecksRequest = {
  datasetCode: string;
  user: object;
  context: object;
  operation: "CREATE" | "UPDATE" | "DELETE"; // required; 'READ' or unknown → 400
  ids?: string[]; // required non-empty for UPDATE/DELETE; absent for CREATE
};
type WriteChecksResponse = {
  touchSql?: string; // pre-state check; present for UPDATE and DELETE
  resultSql?: string; // post-state check; present for CREATE and UPDATE
  mode: string;
  reason?: string;
};
```

`ids` is required and non-empty for `UPDATE` and `DELETE` — the checks answer about named rows, inlined server-side as typed literals. There is no `{{ids}}` template on these operations, so `substituteIds` applies only to the CREATE path. An empty target set is a client-side no-op: skip the call and the checks entirely — nothing to authorize.

An absent response field means _this operation has no such phase_ — never allow. A present field whose union is empty renders `FALSE` and denies every row in the check set.

`invariantSql` is gone (it never had a producer). Drop it from the response types and parsers; the possible integrity layer will define its own contract.

The timing contract, replacing the v1 table:

| Mutation | touchSql                                  | resultSql                                           |
| -------- | ----------------------------------------- | --------------------------------------------------- |
| CREATE   | absent                                    | after the insert, over the ids of the inserted rows |
| UPDATE   | before the update, over the requested ids | after the update, over the same ids                 |
| DELETE   | before the delete                         | absent                                              |

Both run against the application's database inside the mutation's transaction; `false` from either denies and rolls back the whole mutation. No partial success, no silent narrowing on named rows.

**CREATE:** the v1-era after-CREATE execution of the pre-state check is not removed but _replaced_. The path becomes: insert → take the ids of the inserted rows → substitute them into the `{{ids}}` template in `resultSql` → execute → roll back on false. The server cannot inline those ids (they exist only after the insert), so a CREATE response always carries the template, and sending `ids` in a CREATE request is `400`. This is not the old conflation returning: the v1 check ran the pre-state union against created rows; the new one runs the RESULT union, answering only "may this user produce this state".

Fail-closed responses:

| Situation                                                   | Response                                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Dataset well-formed but not registered                      | `200`, `SELECT FALSE` in every field the operation has, `reason: "METADATA_MISSING"` |
| Dataset code malformed                                      | `400`                                                                                |
| `operation` missing, unknown, or `"READ"`                   | `400`                                                                                |
| `ids` sent with CREATE, or missing/empty with UPDATE/DELETE | `400`                                                                                |

Surface `reason` distinctly from an ordinary policy deny — it names a configuration gap, not a rule.

#### New: `conditions/touch` — bulk mutations by predicate

When the ids are known only after the mutation (`UPDATE … WHERE <predicate>`), use the second discipline instead of the named-rows checks:

```
POST /api/v1/abac/conditions/touch
{ datasetCode, user, context, alias, operation: 'UPDATE' | 'DELETE' }   // CREATE → 400 (no WHERE)
// → { touchCondition: string, mode: string, reason?: string }
```

`touchCondition` is a bare boolean fragment of the operation's TOUCH union (aliased like `conditions/read`). The developer composes it into the bulk statement's `WHERE` — rows outside the subject's touch union are simply not touched. That narrowing is deliberate and visible in the query; it is the same trust tier as READ filtration.

The bulk recipes:

- **DELETE:** `DELETE … WHERE <predicate> AND (<touchCondition>)` — complete; a delete has no result phase.
- **UPDATE:** `UPDATE … WHERE <predicate> AND (<touchCondition>) RETURNING <pk>`, then call `conditions/write` with `operation: "UPDATE"` and the returned ids and execute **only `resultSql`** — never `touchSql` post-hoc (the pre-state it checks no longer exists; running it would deny legitimate updates). Deny → roll back, same transaction.

An empty touch union renders `FALSE`, so the composed statement affects zero rows — the intended fail-closed scope composition, not an error.

If ids are known upfront, prefer the named-rows checks — they are the stricter promise (deny-whole over the enumerated rows).
