# @arkveil/nest

## Installation

```bash
npm install @arkveil/nest
# or
yarn add @arkveil/nest
# or
pnpm add @arkveil/nest
```

## Features

- 🔒 **Declarative Permission Checks** - Use decorators to protect your endpoints
- 🌐 **Global Module** - Configure once, use everywhere
- 🔄 **Async Configuration** - Support for async configuration with dependency injection
- 📡 **Multi-Protocol Support** - Works with HTTP, GraphQL, and WebSocket contexts
- 🎯 **Type-Safe** - Full TypeScript support with type definitions

## Quick Start

### 1. Configure the Module

#### Option A: Synchronous Configuration

```typescript
import { Module } from "@nestjs/common";
import { ArkveilModule } from "@arkveil/nest";

@Module({
  imports: [
    ArkveilModule.forRoot({
      serviceUrl: "https://api.arkveil.com",
      apiKey: "your-api-key",
      getUserId: (req) => req.user?.id,
      getUserAttributes: (req) => ({
        email: req.user?.email,
        role: req.user?.role,
      }),
      getContextAttributes: (req) => ({
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      }),
    }),
  ],
})
export class AppModule {}
```

#### Option B: Async Configuration

```typescript
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ArkveilModule } from "@arkveil/nest";

@Module({
  imports: [
    ConfigModule.forRoot(),
    ArkveilModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        serviceUrl: configService.get("ARKVEIL_SERVICE_URL"),
        apiKey: configService.get("ARKVEIL_API_KEY"),
        getUserId: (req) => req.user?.id,
        getUserAttributes: (req) => ({
          email: req.user?.email,
          role: req.user?.role,
        }),
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
```

### 2. Protect Your Endpoints

Use the `@PermissionPoint` decorator to protect your endpoints:

```typescript
import { Controller, Get, Post, Delete } from "@nestjs/common";
import { PermissionPoint } from "@arkveil/nest";

@Controller("articles")
export class ArticlesController {
  @Get()
  @PermissionPoint("content-service.article-read")
  getAllArticles() {
    return "List of articles";
  }

  @Post()
  @PermissionPoint("content-service.article-create")
  createArticle() {
    return "Article created";
  }

  @Delete(":id")
  @PermissionPoint("content-service.article-delete")
  deleteArticle() {
    return "Article deleted";
  }

  @Get("/admin")
  @PermissionPoint("content-service.admin-access")
  adminAction() {
    return "Admin content";
  }
}
```

## Configuration Options

### ArkveilModuleOptions

| Option                  | Type       | Required | Description                                  |
| ----------------------- | ---------- | -------- | -------------------------------------------- |
| `serviceUrl`            | `string`   | Yes      | The URL of your Arkveil service              |
| `apiKey`                | `string`   | Yes      | Your Arkveil API key                         |
| `version`               | `string`   | No       | API version (default: "v1")                  |
| `timeout`               | `number`   | No       | Request timeout in milliseconds              |
| `retryAttempts`         | `number`   | No       | Number of retry attempts for failed requests |
| `logger`                | `Logger`   | No       | Custom logger instance                       |
| `getUserId`             | `Function` | No       | Extract user ID from request                 |
| `getUserAttributes`     | `Function` | No       | Extract user attributes from request         |
| `getResourceAttributes` | `Function` | No       | Extract resource attributes from request     |
| `getContextAttributes`  | `Function` | No       | Extract context attributes from request      |
| `onDenied`              | `Function` | No       | Custom handler for denied access             |

## Advanced Usage

### Custom User ID Extraction

```typescript
ArkveilModule.forRoot({
  serviceUrl: "https://api.arkveil.com",
  apiKey: "your-api-key",
  getUserId: (req) => {
    // Custom logic to extract user ID
    return req.headers["x-user-id"] || req.user?.id;
  },
});
```

### Adding Context Attributes

```typescript
ArkveilModule.forRoot({
  serviceUrl: "https://api.arkveil.com",
  apiKey: "your-api-key",
  getContextAttributes: (req) => ({
    ip: req.ip,
    userAgent: req.headers["user-agent"],
    timestamp: new Date().toISOString(),
    organizationId: req.user?.organizationId,
  }),
});
```

### Custom Denied Handler

```typescript
ArkveilModule.forRoot({
  serviceUrl: "https://api.arkveil.com",
  apiKey: "your-api-key",
  onDenied: (req, res) => {
    // Custom logic when access is denied
    res.status(403).json({
      error: "Access Denied",
      message: "You do not have the required permissions",
      requestId: req.id,
    });
  },
});
```

### GraphQL Support

The `@PermissionPoint` decorator works seamlessly with GraphQL resolvers:

```typescript
import { Resolver, Query, Mutation } from "@nestjs/graphql";
import { PermissionPoint } from "@arkveil/nest";

@Resolver()
export class ArticleResolver {
  @Query(() => [Article])
  @PermissionPoint("content-service.article-read")
  articles() {
    return this.articleService.findAll();
  }

  @Mutation(() => Article)
  @PermissionPoint("content-service.article-create")
  createArticle(@Args("input") input: CreateArticleInput) {
    return this.articleService.create(input);
  }
}
```

### Using the Guard Directly

If you need more control, you can use the guard directly:

```typescript
import { Controller, Get, UseGuards } from "@nestjs/common";
import { PermissionPointGuard } from "@arkveil/nest";

@Controller("articles")
@UseGuards(PermissionPointGuard)
export class ArticlesController {
  @Get()
  getAllArticles() {
    return "List of articles";
  }
}
```

## Error Handling

The SDK throws standard NestJS exceptions:

- `UnauthorizedException` - When user ID is not found in the request
- `ForbiddenException` - When permission check fails or is denied

You can handle these using NestJS exception filters:

```typescript
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  ForbiddenException,
} from "@nestjs/common";

@Catch(ForbiddenException)
export class ForbiddenExceptionFilter implements ExceptionFilter {
  catch(exception: ForbiddenException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    response.status(403).json({
      statusCode: 403,
      message: "Access Denied",
      timestamp: new Date().toISOString(),
    });
  }
}
```

## How It Works

1. The `@PermissionPoint` decorator marks an endpoint with a permission action ID
2. When a request comes in, the `PermissionPointGuard` intercepts it
3. The guard extracts user information from the request
4. It sends a permission check request to the Arkveil service
5. If permission is granted, the request proceeds; otherwise, a `ForbiddenException` is thrown

## Request Flow

```
Request → @PermissionPoint Decorator → PermissionPointGuard → Arkveil Service → Permission Check → Endpoint Handler
```

## Best Practices

1. **Always configure `getUserId`** - This is essential for permission checks
2. **Use meaningful action IDs** - Follow a consistent naming pattern (e.g., `service.resource.action`)
3. **Add context attributes** - Include relevant information like IP, organization, etc.
4. **Handle exceptions gracefully** - Use exception filters for better error handling
5. **Test permissions** - Write unit tests for your permission logic

## Troubleshooting

### "No user ID found in request"

Make sure your authentication middleware runs before the permission check:

```typescript
// In your main.ts or app.module.ts
app.use(authMiddleware); // This should set req.user
```

### "Permission check failed"

Check that:

- Your Arkveil service URL is correct
- Your API key is valid
- The action ID exists in your Arkveil configuration

### GraphQL context issues

Make sure your GraphQL module is configured to pass the request:

```typescript
GraphQLModule.forRoot({
  context: ({ req }) => ({ req }),
});
```

## License

MIT
