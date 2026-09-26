// Compile-time only: proves the generated file narrows permission codes under
// this scaffold's module system. Never imported at runtime.
import { PermissionPoint } from "@arkveil/nest";
import "./arkveil.generated.js";

// @ts-expect-error — an unknown code must not compile once the generated file is in scope
PermissionPoint("invoices:not-a-code");
