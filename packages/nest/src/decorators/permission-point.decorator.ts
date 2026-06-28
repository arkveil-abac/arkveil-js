import { SetMetadata, UseGuards, applyDecorators } from "@nestjs/common";
import type { ArkveilCode } from "arkveil";
import {
  PermissionPointGuard,
  PERMISSION_POINT_KEY,
} from "../guards/permission-point.guard";

/**
 * Decorator to protect endpoints with Arkveil permission checks.
 *
 * The `code` argument is typed against the {@link ArkveilCode} registry, so
 * once you augment it (typically via a CLI-generated file) you get autocomplete
 * and type-checking for permission codes. Until then it accepts any `string`.
 *
 * @param code - The permission code to check
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
export function PermissionPoint(code: ArkveilCode) {
  return applyDecorators(
    SetMetadata(PERMISSION_POINT_KEY, code),
    UseGuards(PermissionPointGuard)
  );
}

/**
 * Creates a `@PermissionPoint` decorator whose `code` argument is constrained
 * to an explicit union of codes. Use this when you prefer passing the codes as
 * a generic type parameter instead of augmenting the global
 * {@link ArkveilCodeRegistry}.
 *
 * @example
 * ```typescript
 * // permission-point.ts
 * import { createPermissionPoint } from "@arkveil/nest";
 * import type { ArkveilCodes } from "./arkveil.generated";
 *
 * export const PermissionPoint = createPermissionPoint<ArkveilCodes>();
 * ```
 */
export function createPermissionPoint<TCode extends string = ArkveilCode>() {
  return (code: TCode) =>
    applyDecorators(
      SetMetadata(PERMISSION_POINT_KEY, code),
      UseGuards(PermissionPointGuard)
    );
}
