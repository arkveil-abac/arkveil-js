import { Arkveil } from "@arkveil/node";
import type { ArkveilCodes } from "./arkveil.generated";
// Side-effect import: applies the `declare module "arkveil"` augmentation so
// codes and user/context attributes are typed. Produced by:
//   arkveil generate typescript -o arkveil.generated.ts
import "./arkveil.generated";

import express from "express";

const app = express();

// Pass the generated codes union as the generic — every `permissionPoint(...)`
// call below is now autocompleted and type-checked against the real codes.
// `user` / `context` attributes are typed automatically from the registry
// augmented in `arkveil.generated.ts`.
const arkveil = new Arkveil<ArkveilCodes>({
  serviceUrl: "https://api.arkveil.com",
  apiKey:
    "akv_pJ66aXcd20vmUj1b8HGkFyyw_o_ilgJKJMna-dp0YP8Io78QVs_8RbFBwN8DXBQeeWbc",
  getUserAttributes: () => ({
    // `role` is constrained to "admin" | "editor" | "viewer" by the registry.
    role: "admin",
  }),
  onDenied: (req: any, res: any) => {
    console.log(`Access denied to ${req.path}`);
    res.status(403).json({
      error: "Forbidden",
      message: "You don't have permission to access this resource",
      hint: "Contact your administrator",
    });
  },
  logger: console,
});

app.post(
  "/api/articles/delete",
  arkveil.permissionPoint("content-service.article-delete"),
  (req: any, res: any) => {
    res.json({
      success: true,
      message: "Article deleted successfully",
    });
  },
);

app.post(
  "/api/users/create",
  arkveil.permissionPoint("user-service.user-create"),
  async (req: any, res: any) => {
    // Your handler logic here
    res.json({
      success: true,
      message: "User created successfully",
    });
  },
);

app.post(
  "/api/users/ban",
  arkveil.permissionPoint("UserService.banUser"),
  async (req: any, res: any) => {
    // Your handler logic here
    res.json({
      success: true,
      message: "User banned successfully",
    });
  },
);

// Type-safety check: an unregistered code is a compile-time error. The
// `@ts-expect-error` itself fails the build if the code were ever accepted,
// which keeps this guarantee honest.
// @ts-expect-error "billing.refund" is not one of the generated ArkveilCodes
arkveil.permissionPoint("billing.refund");

// Same guarantee for attributes: an unknown `role` is a compile-time error.
new Arkveil<ArkveilCodes>({
  serviceUrl: "https://api.arkveil.com",
  apiKey: "akv_example",
  // @ts-expect-error "superuser" is not in ArkveilUserAttributes["role"]
  getUserAttributes: () => ({ role: "superuser" }),
});

app.listen(3005, () => {
  console.log("Server is running on port 3005");
});
