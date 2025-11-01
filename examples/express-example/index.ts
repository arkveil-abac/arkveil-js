import { Arkveil } from "@arkveil/node";

import express from "express";

const app = express();

const arkveil = new Arkveil({
  serviceUrl: "https://api.arkveil.com",
  apiKey: "your-api-key",
  getUserId: (req: any) => req.user?.id || (req.headers["x-user-id"] as string),
  onDenied: (req: any, res: any) => {
    console.log(`Access denied to ${req.path}`);
    res.status(403).json({
      error: "Forbidden",
      message: "You don't have permission to access this resource",
      hint: "Contact your administrator",
    });
  },
});

app.post(
  "/api/articles/delete",
  arkveil.permissionPoint("content-service.article-delete"),
  (req: any, res: any) => {
    res.json({
      success: true,
      message: "Article deleted successfully",
    });
  }
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
  }
);
