// The getting-started walkthrough's guarded route, verbatim.
import { Controller, Param, Patch } from "@nestjs/common";
import { PermissionPoint } from "@arkveil/nest";
import "./arkveil.generated.js";

@Controller("invoices")
export class InvoicesController {
  @Patch(":id")
  @PermissionPoint("invoices:edit")
  edit(@Param("id") id: string) {
    return { id, status: "updated" };
  }
}
