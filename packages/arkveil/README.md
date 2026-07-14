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
  code: "content-service.article-delete",
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
  code: "content-service.article-delete", // ✅ autocompletes
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

| Option                 | Type                                  | Default  | Description                                       |
| ---------------------- | ------------------------------------- | -------- | ------------------------------------------------- |
| `serviceUrl`           | `string` (required)                   | —        | Arkveil API service URL                           |
| `apiKey`               | `string` (required)                   | —        | Your API key                                      |
| `version`              | `"v1"`                                | `"v1"`   | API version                                       |
| `timeout`              | `number`                              | `5000`   | Per-request timeout in milliseconds               |
| `retryAttempts`        | `number`                              | `3`      | Attempts for failed / transient requests          |
| `getUserAttributes`    | `(req) => user`                       | —        | Extract user attributes from a request            |
| `getContextAttributes` | `(req) => context`                    | —        | Extract context attributes from a request         |
| `logger`               | `Logger`                              | —        | Custom logger instance                            |
| `onDenied`             | `(req, res, reason?) => void`         | —        | Custom handler for denied access                  |

### `checkPermission(request)`

Checks a permission and resolves to `{ granted: boolean }`. Network failures,
timeouts, and transient `5xx` / `429` responses are retried with exponential
backoff; if the check ultimately fails it resolves to `{ granted: false }`
(fail-closed).

## Row-level data protection

Arkveil can also protect **data** (datasets = database tables). The SDK's job
is to obtain SQL enforcement artifacts from Arkveil and apply them to your
application's own queries — it never receives policies, only rendered SQL
(PostgreSQL-flavored today). Both endpoints share the base URL and API-key
auth with `checkPermission`, and are served identically by the Arkveil kernel
and a self-hosted `arkveil-runtime` sidecar — point `serviceUrl` at either.

A **dataset id** is exactly three dot-separated lowercase segments:
`datasource.schema.table`. The SDK normalizes (trim + lowercase) before
sending and throws on any other shape — there is no 2-segment shorthand and no
4-segment form.

### `buildReadCondition(request)` — filtering reads

```typescript
const { readCondition } = await arkveil.buildReadCondition({
  datasetId: "billing.public.payments",
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

### `buildWriteChecks(request)` — validating mutations

```typescript
const { writeSql } = await arkveil.buildWriteChecks({
  datasetId: "billing.public.payments",
  user: { id: "user-123", role: "manager" },
  context: {},
  ids: [42, 7], // primary keys the mutation touches (sent as strings)
});

// Inside the mutation's transaction:
const [{ allowed }] = await tx.query(`${writeSql} AS allowed`);
if (!allowed) throw rollback();
```

`writeSql` is a single statement returning one boolean: `true` ⇒ the mutation
touches no forbidden row. Execute it against **your** database, inside the
mutation's transaction, and roll back on `false`. *When* it runs is part of
the contract:

| Mutation | Execute `writeSql`         | With ids…                  |
| -------- | -------------------------- | -------------------------- |
| CREATE   | **after** the insert       | the just-inserted rows' ids |
| UPDATE   | **before and after**       | the ids the statement targets |
| DELETE   | **before** the delete      | the ids the statement targets |

(Before-UPDATE proves the user may touch those rows at all; after-UPDATE
proves the modified rows are still within their writable set. Rows that don't
exist are not a violation — deleting an already-deleted id stays idempotent.)

When `ids` is omitted, `writeSql` comes back with a literal `{{ids}}`
placeholder; fill it with the `substituteIds` helper, which renders the values
as escaped SQL literals:

```typescript
import { substituteIds } from "arkveil";

const sql = substituteIds(writeSql, insertedIds);
```

### Fail-closed behavior

- A well-formed dataset id that isn't registered in Arkveil returns
  `writeSql: "SELECT FALSE"` with `reason: "METADATA_MISSING"` — a
  **configuration gap**, not a policy deny. The SDK logs it distinctly;
  compare against the exported `METADATA_MISSING` constant to surface it.
- Transport failures and non-OK responses never widen access: after retries,
  `buildReadCondition` resolves to `{ readCondition: "FALSE", mode: "UNAVAILABLE" }`
  and `buildWriteChecks` to `{ writeSql: "SELECT FALSE", invariantSql: [], mode: "UNAVAILABLE" }`.
- `mode` is `"NORMAL"` unless the serving side is degraded (e.g. a sidecar
  past its staleness bound). Any other value is logged as a warning — honor
  the SQL, watch the diagnostics.
- `invariantSql` is always `[]` today; it is wired through for when INVARIANT
  policy evaluation lands.

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
