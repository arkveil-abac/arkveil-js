# @arkveil/node

## Installation

```bash
npm install @arkveil/node
# or
yarn add @arkveil/node
# or
bun add @arkveil/node
```

## Usage

### Basic Setup

```typescript
import { Arkveil } from "@arkveil/node";
import express from "express";

const app = express();

const arkveil = new Arkveil({
  serviceUrl: "https://api.arkveil.com",
  apiKey: "your-api-key",
  getUserAttributes: (req) => ({ id: req.user?.id }),
  onDenied: (req, res) => {
    res.status(403).json({
      error: "Forbidden",
      message: "You don't have permission to access this resource",
    });
  },
});
```

### Using `permissionPoint()`

The `permissionPoint()` method provides a clean middleware approach for permission checking:

```typescript
app.post(
  "/api/articles/delete",
  arkveil.permissionPoint("content-service.article-delete"),
  (req, res) => {
    res.json({
      success: true,
      message: "Article deleted successfully",
    });
  }
);
```

## Typed Codes & Attributes

Generate the typed file with the Arkveil CLI
(`arkveil generate typescript -o src/arkveil.generated.ts`) and pass the codes
union as a generic to get autocomplete and compile-time checking on
`permissionPoint`:

```typescript
import { Arkveil } from "@arkveil/node";
import type { ArkveilCodes } from "./arkveil.generated";

const arkveil = new Arkveil<ArkveilCodes>({ serviceUrl, apiKey });

arkveil.permissionPoint("content-service.article-delete"); // ✅ autocompletes
arkveil.permissionPoint("typo"); // ❌ compile error
```

Alternatively, import the generated file once (`import "./arkveil.generated"`) and
the default generics pick up codes **and** `user`/`context` attributes without
passing anything explicitly. See the generated file format in the root README.

## API

### `Arkveil`

Extends the base Arkveil class with Node.js-specific middleware functionality.

#### Constructor Options

- `serviceUrl` (string, required): Arkveil API service URL
- `apiKey` (string, required): Your API key
- `version` (string, optional): API version (default: `"v1"`)
- `timeout` (number, optional): Request timeout in milliseconds (default: `5000`)
- `retryAttempts` (number, optional): Number of attempts for failed/transient requests (default: `3`)
- `getUserAttributes` (function, optional): Extract user attributes from request
- `getContextAttributes` (function, optional): Extract context attributes from request
- `logger` (Logger, optional): Custom logger instance
- `onDenied` (function, optional): Custom handler for denied access

#### Methods

##### `permissionPoint(code: string)`

Creates a middleware that checks permissions before allowing access to the route handler.

**Parameters:**

- `code`: The permission code to check (e.g., "content-service.article-delete")

**Returns:** Middleware function

**Features:**

- Resolves user and context attributes from the configured `getUserAttributes` / `getContextAttributes`
- Checks permission before allowing access to the route handler
- Calls `onDenied` handler if permission is denied
- Works with Express, Fastify, and other Node.js HTTP frameworks

## License

MIT
