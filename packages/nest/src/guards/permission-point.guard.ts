import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Arkveil, type PermissionCheckRequest } from "arkveil";
import { getRequestFromContext } from "../utils/get-request-from-context";

export const PERMISSION_POINT_KEY = "arkveil:permission-point";

@Injectable()
export class PermissionPointGuard implements CanActivate {
  private readonly logger = new Logger(PermissionPointGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly arkveil: Arkveil
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const actionId = this.reflector.getAllAndOverride<string>(
      PERMISSION_POINT_KEY,
      [context.getHandler(), context.getClass()]
    );

    // If no permission point is set, deny access
    if (!actionId) {
      this.logger.warn("[Arkveil] No permission point set for action");
      throw new ForbiddenException(
        "Permission point is required for permission check"
      );
    }

    const request = getRequestFromContext(context);

    try {
      const userId = request.user?.id || request.userId;

      if (!userId) {
        this.logger.warn("[Arkveil] No user ID found in request");
        throw new UnauthorizedException(
          "User ID is required for permission check"
        );
      }

      const permissionRequest: PermissionCheckRequest = {
        actionId,
        user: { id: userId },
        context: {},
      };

      if (request.user) {
        permissionRequest.user = {
          ...permissionRequest.user,
          ...request.user,
        };
      }

      permissionRequest.context = {
        method: request.method,
        url: request.url || request.path,
        ip: request.ip,
        ...request.arkveilContext,
      };

      const result = await this.arkveil.checkPermission(permissionRequest);

      if (!result.granted) {
        this.logger.warn(
          `[Arkveil] Access denied for user ${userId} to action ${actionId}`
        );
        throw new ForbiddenException(
          "You do not have permission to perform this action"
        );
      }

      return true;
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      this.logger.error("[Arkveil] Permission check error:", error);
      throw new ForbiddenException("Permission check failed. Access denied.");
    }
  }
}
