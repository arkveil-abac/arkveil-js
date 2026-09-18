# arkveil

Runtime-agnostic core SDK for [Arkveil](https://www.arkveil.com/) — a
lightweight, comprehensive ABAC platform that brings fine-grained access
control to your applications through simple, structured permission formulas.

This is the framework-agnostic core. For framework integrations see
[`@arkveil/node`](https://www.npmjs.com/package/@arkveil/node) (Express /
Fastify middleware) and [`@arkveil/nest`](https://www.npmjs.com/package/@arkveil/nest)
(NestJS decorators and guards).

## Installation

```bash
npm install arkveil
# or
yarn add arkveil
# or
bun add arkveil
```

## Usage

```typescript
import { Arkveil } from "arkveil";

const arkveil = new Arkveil({
  serviceUrl: "https://api.arkveil.com",
  apiKey: "your-api-key",
});

const result = await arkveil.checkPermission({
  actionCode: "content-service.article-delete",
  user: { id: "user-123", role: "admin" },
  context: { region: "EU" },
});

if (result.granted) {
  // Allow access
} else {
  // Deny access
}
```

## Typed Codes & Attributes

The Arkveil CLI generates one TypeScript file that types the SDK against your
project — permission codes **and** `user`/`context` attributes — so every place
that takes a `code` and the attribute objects get autocomplete and reject
unknown or mistyped values at compile time.

```bash
arkveil generate typescript -o src/arkveil.generated.ts
```

```typescript
// arkveil.generated.ts (auto-generated — do not edit by hand)
declare module "arkveil" {
  interface ArkveilCodeRegistry {
    codes: "content-service.article-delete" | "user-service.user-create";
  }
  interface ArkveilUserRegistry {
    attributes: { id?: string; role: "admin" | "editor" | "viewer" };
  }
  interface ArkveilContextRegistry {
    attributes: { ipAddress?: string; region?: "EU" | "US" };
  }
}
```

Import the generated file once for its side effect and the default generics pick
everything up:

```typescript
import { Arkveil } from "arkveil";
import "./arkveil.generated";

await arkveil.checkPermission({
  actionCode: "content-service.article-delete", // ✅ autocompletes
  user: { role: "admin" }, // ✅ rejects unknown keys
  context: { region: "EU" },
});
```

Prefer explicit generics? Pass the generated types instead of importing the
file:

```typescript
import type {
  ArkveilCodes,
  ArkveilUserAttributes,
  ArkveilContextAttributes,
} from "./arkveil.generated";

const arkveil = new Arkveil<
  ArkveilCodes,
  ArkveilUserAttributes,
  ArkveilContextAttributes
>({ serviceUrl, apiKey });
```

Until the registry is augmented, codes stay `string` and `user` / `context`
stay `Record<string, any>`, so untyped usage keeps working.

## API

### `new Arkveil(options)`

| Option                 | Type                          | Default | Description                               |
| ---------------------- | ----------------------------- | ------- | ----------------------------------------- |
| `serviceUrl`           | `string` (required)           | —       | Arkveil API service URL                   |
| `apiKey`               | `string` (required)           | —       | Your API key                              |
| `version`              | `"v1"`                        | `"v1"`  | API version                               |
| `timeout`              | `number`                      | `5000`  | Per-request timeout in milliseconds       |
| `retryAttempts`        | `number`                      | `3`     | Attempts for failed / transient requests  |
| `getUserAttributes`    | `(req) => user`               | —       | Extract user attributes from a request    |
| `getContextAttributes` | `(req) => context`            | —       | Extract context attributes from a request |
| `logger`               | `Logger`                      | —       | Custom logger instance                    |
| `onDenied`             | `(req, res, reason?) => void` | —       | Custom handler for denied access          |

### `checkPermission(request)`

Checks a permission and resolves to `{ granted, reason?, mode }`. Network
failures, timeouts, and transient `5xx` / `429` responses are retried with
exponential backoff; if the check ultimately fails it resolves to
`{ granted: false, mode: "UNAVAILABLE" }` (fail-closed).

`reason` is set when a denial is **not an ordinary policy deny**, so your
logs, error handling and audit can tell an infrastructure incident from a
rule at work. The values are exported as constants:

| `reason`                 | Meaning                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `RUNTIME_REQUIRED`       | The rule reads a dataset, which only a connected `arkveil-runtime` sidecar can evaluate; Arkveil Cloud alone answers `false`.         |
| `DATASOURCE_UNRESOLVED`  | The sidecar has no connection for the referenced datasource, or the mirror has not replicated it yet.                                 |
| `DATASOURCE_ERROR`       | The datasource query behind the rule failed.                                                                                          |
| `EVALUATION_ERROR`       | The engine failed to evaluate the rule.                                                                                               |
| `ATTRIBUTE_INCOMPATIBLE` | A `user` / `context` value does not match the type its attribute schema declares and was evaluated as absent (fix payload or schema). |

A grant carries no `reason`. `mode` is `"NORMAL"` unless the serving side is
degraded — a sidecar past its staleness bound serves `"MIRROR_STALE"` — and
the SDK logs any other value as a warning. `onDenied` receives the reason as
its third argument; a denial stays a denial either way.

## Row-level data protection

Arkveil can also protect **data** (datasets = database tables). The SDK's job
is to obtain SQL enforcement artifacts from Arkveil and apply them to your
application's own queries — it never receives policies, only rendered SQL
(PostgreSQL-flavored today). All three endpoints share the base URL and
API-key auth with `checkPermission`, and are served identically by the Arkveil
kernel and a self-hosted `arkveil-runtime` sidecar — point `serviceUrl` at
either.

A **dataset code** is exactly three dot-separated lowercase segments:
`datasource.schema.table`. The SDK normalizes (trim + lowercase) before
sending and throws on any other shape — there is no 2-segment shorthand and no
4-segment form.

Data policies come in three types, and each produces a different artifact:

| Type     | Governs                                  | Judged                                | SDK method                                 |
| -------- | ---------------------------------------- | ------------------------------------- | ------------------------------------------ |
| `READ`   | which rows a user sees                   | at read time                          | `buildReadCondition`                       |
| `TOUCH`  | which existing rows a mutation may touch | before the mutation, on current state | `buildWriteChecks` / `buildTouchCondition` |
| `RESULT` | the state a mutation may leave rows in   | after the mutation, same transaction  | `buildWriteChecks`                         |

`TOUCH` governs `UPDATE`/`DELETE`, `RESULT` governs `CREATE`/`UPDATE`. Each
operation has its own union of grants; a mutation whose union has no
applicable policy is denied whole.

### `buildReadCondition(request)` — filtering reads

```typescript
const { readCondition } = await arkveil.buildReadCondition({
  datasetCode: "billing.public.payments",
  user: { id: "user-123", role: "manager" },
  context: {},
  alias: "p", // pass whenever the protected table is aliased or joined
});

// AND it into your query's WHERE clause:
const rows = await db.query(
  `SELECT * FROM payments p WHERE p.tenant_id = $1 AND (${readCondition})`,
  [tenantId],
);
```

`readCondition` is one SQL boolean expression. With `alias` omitted, columns
are qualified `"schema"."table"."column"`. **`FALSE` is a normal response**
("no applicable policy ⇒ no rows") — apply it like any other condition; never
fall back to unfiltered access.

### `buildWriteChecks(request)` — mutations over named rows

When you know the primary keys the mutation targets, ask about those rows:

```typescript
const { touchSql, resultSql } = await arkveil.buildWriteChecks({
  datasetCode: "billing.public.payments",
  user: { id: "user-123", role: "manager" },
  context: {},
  operation: "UPDATE", // "CREATE" | "UPDATE" | "DELETE"
  ids: [42, 7], // required non-empty for UPDATE/DELETE; absent for CREATE
});

// Inside the mutation's transaction:
const [{ allowed: mayTouch }] = await tx.query(`${touchSql} AS allowed`);
if (!mayTouch) throw rollback();

await tx.query(`UPDATE payments SET amount = $1 WHERE id = ANY($2)`, [10, ids]);

const [{ allowed: mayResult }] = await tx.query(`${resultSql} AS allowed`);
if (!mayResult) throw rollback();
```

Each check is a single statement returning one boolean. Which check exists,
and when it runs, is the contract:

| Mutation | `touchSql` (pre-state)            | `resultSql` (post-state)                    |
| -------- | --------------------------------- | ------------------------------------------- |
| CREATE   | absent                            | **after** the insert, over the inserted ids |
| UPDATE   | **before** the update, over `ids` | **after** the update, over the same ids     |
| DELETE   | **before** the delete, over `ids` | absent                                      |

Both run against **your** database, inside the mutation's transaction; `false`
from either denies and rolls back the whole mutation. No partial success, no
silent narrowing on named rows.

`ids` are sent as strings and inlined server-side as typed literals — so
`UPDATE`/`DELETE` checks arrive ready to execute. An **empty** `ids` list
targets nothing: the SDK skips the request and returns `{ mode: "NO_OP" }` —
run no checks and no mutation.

#### The CREATE path

A `CREATE` sends no `ids` (they exist only after the insert), so its
`resultSql` comes back with an `{{ids}}` template. Insert first, then fill the
template with the ids the insert produced:

```typescript
import { resolveCreateResultSql } from "arkveil";

const checks = await arkveil.buildWriteChecks({
  datasetCode: "billing.public.payments",
  user,
  context: {},
  operation: "CREATE",
});

const inserted = await tx.query(
  `INSERT INTO payments (amount) VALUES ($1) RETURNING id`,
  [amount],
);
const sql = resolveCreateResultSql(
  checks,
  inserted.rows.map((r) => r.id),
);
const [{ allowed }] = await tx.query(`${sql} AS allowed`);
if (!allowed) throw rollback();
```

`resolveCreateResultSql` returns `SELECT FALSE` whenever the response cannot
be completed (no `resultSql`, or one with no template), so a degraded response
can never produce a check that passes. `substituteIds` is the lower-level
helper it uses; the `{{ids}}` template exists on this path only.

### `buildTouchCondition(request)` — bulk mutations by predicate

When the rows are named by a predicate rather than by id, compose the touch
condition into the statement's `WHERE` clause instead:

```typescript
const { touchCondition } = await arkveil.buildTouchCondition({
  datasetCode: "billing.public.payments",
  user,
  context: {},
  alias: "p",
  operation: "UPDATE", // "UPDATE" | "DELETE" — CREATE has no WHERE clause
});
```

Two recipes, each inside one transaction:

**DELETE** — complete as-is; a delete has no result phase:

```sql
DELETE FROM payments p WHERE p.status = 'draft' AND (<touchCondition>)
```

**UPDATE** — compose, return the ids you touched, then run **only** the
post-state check for them:

```typescript
const updated = await tx.query(
  `UPDATE payments p SET amount = $1
     WHERE p.status = 'draft' AND (${touchCondition})
     RETURNING p.id`,
  [amount],
);
const { resultSql } = await arkveil.buildWriteChecks({
  datasetCode: "billing.public.payments",
  user,
  context: {},
  operation: "UPDATE",
  ids: updated.rows.map((r) => r.id),
});
const [{ allowed }] = await tx.query(`${resultSql} AS allowed`);
if (!allowed) throw rollback();
```

Never run `touchSql` post-hoc here: the pre-state it judges no longer exists,
so it would deny legitimate updates. Rows outside the subject's touch union
are simply not touched — that narrowing is deliberate and visible in the
query, the same trust tier as read filtration. An empty touch union renders
`FALSE`, so the statement affects zero rows; that is the intended fail-closed
composition, not an error. When the ids are known upfront, prefer
`buildWriteChecks` — deny-whole over the enumerated rows is the stricter
promise.

### Fail-closed behavior

- A well-formed dataset code that isn't registered in Arkveil comes back with
  `SELECT FALSE` in every field the operation has and
  `reason: "METADATA_MISSING"` — a **configuration gap**, not a policy deny.
  The SDK logs it distinctly; compare against the exported `METADATA_MISSING`
  constant to surface it.
- A response missing a field its operation requires (an `UPDATE` with no
  `touchSql`, say), or carrying an `{{ids}}` template where the ids should
  have been inlined, is a **contract violation**: the SDK denies rather than
  proceeding unchecked and reports `reason: "CONTRACT_VIOLATION"`. Absent
  fields mean "this operation has no such phase" only where the timing table
  above says so.
- Transport failures and non-OK responses never widen access: after retries,
  `buildReadCondition` and `buildTouchCondition` resolve to `"FALSE"` and
  `buildWriteChecks` to `SELECT FALSE` in every field the operation has, all
  with `mode: "UNAVAILABLE"`.
- A malformed `datasetCode`, an unknown `operation`, or `ids` that contradict
  the operation (sent with `CREATE`, missing for `UPDATE`/`DELETE`) **throw** —
  those are programming errors, and the server answers them `400`. No write
  proceeds either way: the caller never receives a check to pass.
- `mode` is `"NORMAL"` unless the serving side is degraded (e.g. a sidecar
  past its staleness bound). Any other value is logged as a warning — honor
  the SQL, watch the diagnostics.
- `reason: "ATTRIBUTE_INCOMPATIBLE"` means a value in `user` or `context` does
  not match the type its attribute schema declares (`"u-42"` for a `uuid`
  `user.id`, `"abc"` for an `integer`) and was evaluated as **absent**. It is
  not a deny: the SQL is applied exactly as returned and may still admit rows
  (an ownership filter folded away, a regional one survived). The SDK logs it
  as a warning naming the dataset; compare against the exported
  `ATTRIBUTE_INCOMPATIBLE` constant. Fix the payload or the schema, not the
  policy. A missing key or a JSON `null` is an optional attribute and stays
  silent.

Field-level masking (PROJECTION policies) has no HTTP contract yet and is not
part of this SDK.

## Features

- 🌍 **Runtime agnostic** — works in any JavaScript environment with `fetch`
- 🔧 **Flexible** — build your own platform-specific implementations
- 📦 **Lightweight** — zero runtime dependencies
- 🔄 **Retry logic** — built-in retry with exponential backoff and jitter
- 🧬 **Typed codes & attributes** — typed from your project's schemas

## Requirements

Node.js >= 18 (uses the global `fetch` / `AbortController`).

## License

MIT
