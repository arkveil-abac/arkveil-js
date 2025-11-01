import { SetMetadata, UseGuards, applyDecorators } from "@nestjs/common";
import {
  PermissionPointGuard,
  PERMISSION_POINT_KEY,
} from "../guards/permission-point.guard";

/**
 * Decorator to protect endpoints with Arkveil permission checks
 *
 * @param actionId - The permission action ID to check
 *
 * @example
 * ```typescript
 * @PermissionPoint("content-service.article-delete")
 * @Delete("/articles/:id")
 * deleteArticle() {
 *   return "Protected content";
 * }
 * ```
 */
export function PermissionPoint(actionId: string) {
  return applyDecorators(
    SetMetadata(PERMISSION_POINT_KEY, actionId),
    UseGuards(PermissionPointGuard)
  );
}
