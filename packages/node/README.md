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
  getUserId: (req) => req.user?.id,
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

## API

### `Arkveil`

Extends the base Arkveil class with Node.js-specific middleware functionality.

#### Constructor Options

- `serviceUrl` (string, required): Arkveil API service URL
- `apiKey` (string, required): Your API key
- `getUserId` (function, optional): Extract user ID from request
- `getUserAttributes` (function, optional): Extract user attributes from request
- `getContextAttributes` (function, optional): Extract context attributes from request
- `onDenied` (function, optional): Custom handler for denied access

#### Methods

##### `permissionPoint(actionId: string)`

Creates a middleware that checks permissions before allowing access to the route handler.

**Parameters:**

- `actionId`: The permission action ID to check (e.g., "content-service.article-delete")

**Returns:** Middleware function

**Features:**

- Automatically extracts user ID and attributes from request
- Checks permission before allowing access to the route handler
- Calls `onDenied` handler if permission is denied
- Works with Express, Fastify, and other Node.js HTTP frameworks

## License

MIT
