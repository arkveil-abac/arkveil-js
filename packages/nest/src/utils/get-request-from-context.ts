import type { ExecutionContext } from "@nestjs/common";
import type { GqlContextType } from "@nestjs/graphql";

/**
 * Extracts the request object from either HTTP, GraphQL or WebSocket execution context.
 *
 * `@nestjs/graphql` is an optional peer dependency, so it is imported lazily and
 * only when a GraphQL context is actually encountered. This keeps the package
 * importable in plain REST/WebSocket NestJS apps that have not installed it.
 *
 * @param context - The execution context
 * @returns The request object
 */
export async function getRequestFromContext(context: ExecutionContext) {
  const contextType = context.getType<GqlContextType>();

  if (contextType === "graphql") {
    const { GqlExecutionContext } = await import("@nestjs/graphql");
    return GqlExecutionContext.create(context).getContext().req;
  }

  if (contextType === "ws") {
    return context.switchToWs().getClient();
  }

  return context.switchToHttp().getRequest();
}
