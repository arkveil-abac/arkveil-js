# Arkveil SDK

Arkveil is the first lightweight and comprehensive ABAC platform, designed to bring fine-grained security into your applications with clarity and control. It lets you express complex access logic through simple, structured formulas.

## 🚀 Quick Start

### NestJS

```bash
npm install @arkveil/nest
```

```typescript
import { Module } from "@nestjs/common";
import { ArkveilModule } from "@arkveil/nest";

@Module({
  imports: [
    ArkveilModule.forRoot({
      serviceUrl: "https://api.arkveil.com",
      apiKey: "your-api-key",
      getUserId: (req) => req.user?.id,
    }),
  ],
})
export class AppModule {}
```

Use the `@PermissionPoint` decorator:

```typescript
import { Controller, Get } from "@nestjs/common";
import { PermissionPoint } from "@arkveil/nest";

@Controller("articles")
export class ArticlesController {
  @Get("/admin")
  @PermissionPoint("content-service.article-delete")
  adminAction() {
    return "Protected content";
  }
}
```

### Express / Node.js

```bash
npm install @arkveil/node arkveil
```

```typescript
import { Arkveil } from "@arkveil/node";

const arkveil = new Arkveil({
  serviceUrl: "https://api.arkveil.com",
  apiKey: "your-api-key",
  getUserId: (req) => req.user?.id,
});

app.post(
  "/api/admin",
  arkveil.permissionPoint("content-service.article-delete"),
  (req, res) => {
    res.json({ message: "Protected content" });
  }
);
```

### Core SDK (Runtime Agnostic)

```bash
npm install arkveil
```

```typescript
import { Arkveil } from "arkveil";

const arkveil = new Arkveil({
  serviceUrl: "https://api.arkveil.com",
  apiKey: "your-api-key",
});

const result = await arkveil.checkPermission({
  actionId: "content-service.article-delete",
  user: { id: "user-123" },
  context: {},
});

if (result.granted) {
  // Allow access
} else {
  // Deny access
}
```

## ✨ Features

### NestJS SDK (`@arkveil/nest`)

- 🔒 **Declarative Permission Checks** - Use `@PermissionPoint` decorator
- 🌐 **Global Module** - Configure once, use everywhere
- 🔄 **Async Configuration** - Support for ConfigService and dependency injection
- 📡 **Multi-Protocol Support** - HTTP, GraphQL, and WebSocket contexts
- 🎯 **Type-Safe** - Full TypeScript support

### Node.js SDK (`@arkveil/node`)

- 🚀 **Framework Agnostic** - Works with Express, Fastify, and more
- 🔌 **Middleware Pattern** - Easy integration with existing apps
- 🎨 **Customizable** - Custom user extraction and denial handlers
- ⚡ **Fast** - Optimized for performance

### Core SDK (`arkveil`)

- 🌍 **Runtime Agnostic** - Works in any JavaScript environment
- 🔧 **Flexible** - Build your own platform-specific implementations
- 📦 **Lightweight** - Minimal dependencies
- 🔄 **Retry Logic** - Built-in retry mechanism for failed requests

## 🛠️ Development

This project uses [Turborepo](https://turborepo.com/) for monorepo management and [Bun](https://bun.com/) as the JavaScript runtime.

## 📄 License

MIT

## 🔗 Links

- [Website](https://www.arkveil.com/)
- [GitHub](https://github.com/arkveil-abac)
- [NPM](https://www.npmjs.com/package/arkveil)
