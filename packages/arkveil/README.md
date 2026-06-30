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
