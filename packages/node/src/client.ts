import {
  Arkveil,
  type ArkveilParams,
  type PermissionCheckRequest,
} from "arkveil";

export class ArkveilNodeClient extends Arkveil {
  constructor(params: ArkveilParams) {
    super(params);
  }

  /**
   * Node.js middleware that checks permissions before allowing access.
   * Works with Express, Fastify, and other compatible HTTP frameworks.
   *
   * Usage:
   * app.post("/api/admin", arkveil.permissionPoint("content-service.article-delete"), handler)
   *
   * @param actionId - The permission action ID to check
   * @returns Middleware function
   */
  public permissionPoint(actionId: string | (string & {})) {
    return async (req: any, res: any, next?: any) => {
      try {
        const userId = this.getUserId
          ? await this.getUserId(req)
          : req.user?.id || req.userId;

        if (!userId) {
          this.logger?.warn("[Arkveil] No user ID found in request");
          return this.handleDenied(req, res, next);
        }

        const permissionRequest: PermissionCheckRequest = {
          actionId,
          user: { id: userId },
          context: {},
        };

        if (this.getUserAttributes) {
          const userAttributes = await this.getUserAttributes(req);
          permissionRequest.user = {
            ...permissionRequest.user,
            ...userAttributes,
          };
        }

        if (this.getContextAttributes) {
          const contextAttributes = await this.getContextAttributes(req);
          permissionRequest.context = {
            ...permissionRequest.context,
            ...contextAttributes,
          };
        }

        const result = await this.checkPermission(permissionRequest);

        if (result.granted) {
          if (next) {
            return next();
          }
          return;
        } else {
          this.logger?.warn(
            `[Arkveil] Access denied for user ${userId} to action ${actionId}`
          );
          return this.handleDenied(req, res, next);
        }
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
    onDenied?: (req: any, res: any) => void | Promise<void>
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
        })
      );
    }
  }
}
