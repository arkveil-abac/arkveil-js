export { ArkveilModule, type ArkveilModuleOptions } from "./src/arkveil.module";
export { PermissionPointGuard } from "./src/guards/permission-point.guard";
export {
  PermissionPoint,
  createPermissionPoint,
} from "./src/decorators/permission-point.decorator";
export { getRequestFromContext } from "./src/utils/get-request-from-context";
export type {
  ArkveilCode,
  ArkveilCodeRegistry,
  ArkveilUser,
  ArkveilUserRegistry,
  ArkveilContext,
  ArkveilContextRegistry,
} from "arkveil";
export {
  normalizeDatasetCode,
  substituteIds,
  resolveCreateResultSql,
  IDS_PLACEHOLDER,
  DENY_SQL,
  DENY_CONDITION,
  METADATA_MISSING,
  ATTRIBUTE_INCOMPATIBLE,
  RUNTIME_REQUIRED,
  DATASOURCE_UNRESOLVED,
  DATASOURCE_ERROR,
  EVALUATION_ERROR,
  CONTRACT_VIOLATION,
  MODE_UNAVAILABLE,
  MODE_NO_OP,
} from "arkveil";
export type {
  ReadConditionRequest,
  ReadConditionResponse,
  TouchConditionRequest,
  TouchConditionResponse,
  WriteChecksRequest,
  WriteChecksResponse,
  WriteCheckId,
  WriteOperation,
  TouchOperation,
} from "arkveil";
