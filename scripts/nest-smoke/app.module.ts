// The getting-started walkthrough's root module, verbatim except for the
// service URL, which the smoke points at the stub kernel.
import { Module } from "@nestjs/common";
import { ArkveilModule } from "@arkveil/nest";
import { InvoicesController } from "./invoices.controller.js";

@Module({
  imports: [
    ArkveilModule.forRoot({
      serviceUrl: process.env.ARKVEIL_SERVICE_URL ?? "https://api.arkveil.com",
      apiKey: process.env.ARKVEIL_API_KEY!,
      // Arkveil decides what an authenticated user may do. Attributes normally
      // come from your auth layer. The walkthrough fakes them with a header.
      getUserAttributes: (req) =>
        JSON.parse(String(req.headers["x-user"] ?? "{}")),
    }),
  ],
  controllers: [InvoicesController],
})
export class AppModule {}
