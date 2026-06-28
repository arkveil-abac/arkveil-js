import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Arkveil, type ArkveilCode } from "arkveil";
import { getRequestFromContext } from "../utils/get-request-from-context";

export const PERMISSION_POINT_KEY = "arkveil:permission-point";

@Injectable()
export class PermissionPointGuard implements CanActivate {
  private readonly logger = new Logger(PermissionPointGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly arkveil: Arkveil,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const code = this.reflector.getAllAndOverride<ArkveilCode>(
      PERMISSION_POINT_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no permission point is set, deny access
    if (!code) {
      this.logger.warn("[Arkveil] No permission point set for handler");
      throw new ForbiddenException(
        "Permission point is required for permission check",
      );
    }

    const request = await getRequestFromContext(context);

    try {
      const permissionRequest = await this.arkveil.buildPermissionRequest(
        code,
        request,
      );

      const result = await this.arkveil.checkPermission(permissionRequest);

      if (!result.granted) {
        this.logger.warn(`[Arkveil] Access denied to action ${code}`);
        throw new ForbiddenException(
          "You do not have permission to perform this action",
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
