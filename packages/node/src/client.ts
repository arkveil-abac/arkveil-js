import {
  Arkveil,
  type ArkveilParams,
  type ArkveilCode,
  type ArkveilUser,
  type ArkveilContext,
} from "arkveil";

export class ArkveilNodeClient<
  TCode extends string = ArkveilCode,
  TUser extends Record<string, any> = ArkveilUser,
  TContext extends Record<string, any> = ArkveilContext,
> extends Arkveil<TCode, TUser, TContext> {
  constructor(params: ArkveilParams<TUser, TContext>) {
    super(params);
  }

  /**
   * Node.js middleware that checks permissions before allowing access.
   * Works with Express, Fastify, and other compatible HTTP frameworks.
   *
   * Usage:
   * app.post("/api/admin", arkveil.permissionPoint("content-service.article-delete"), handler)
   *
   * @param code - The permission code to check
   * @returns Middleware function
   */
  public permissionPoint(code: TCode) {
    return async (req: any, res: any, next?: any) => {
      try {
        const permissionRequest = await this.buildPermissionRequest(code, req);

        const result = await this.checkPermission(permissionRequest);

        if (result.granted) {
          if (next) {
            return next();
          }
          return;
        }

        this.logger?.warn(`[Arkveil] Access denied to action ${code}`);
        return this.handleDenied(req, res, next);
      } catch (error) {
        this.logger?.error("[Arkveil] permissionPoint error:", error);
        return this.handleDenied(req, res, next);
      }
    };
  }

  /**
   * Node.js-specific implementation of handleDenied
   * Works with Express, Fastify, and other Node.js HTTP frameworks
   */
  override handleDenied(
    req: any,
    res: any,
    next: any,
    onDenied?: (req: any, res: any) => void | Promise<void>,
  ) {
    // Use custom handler if provided (either in request or parameter)
    const customHandler = onDenied || this.onDenied;

    if (customHandler) {
      return customHandler(req, res);
    }

    // Node.js-specific denial handler
    // Detect if this is Express or Fastify style response
    if (res.status && typeof res.status === "function") {
      // Express/Fastify style
      return res.status(403).json({
        error: "Access denied",
        reason: "You do not have permission to perform this action",
      });
    } else {
      // Handle other Node.js HTTP response cases
      res.statusCode = 403;
      res.end(
        JSON.stringify({
          error: "Access denied",
          reason: "You do not have permission to perform this action",
        }),
      );
    }
  }
}
