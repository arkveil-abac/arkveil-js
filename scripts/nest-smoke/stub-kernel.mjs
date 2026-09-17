// Stand-in for the Arkveil kernel: answers POST /api/v1/abac/permissions/check
// with a grant for managers and a deny for everyone else, so the smoke needs
// no credentials. usage: node stub-kernel.mjs <port>
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4010);

createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    if (req.method === "POST" && req.url === "/api/v1/abac/permissions/check") {
      const { user } = JSON.parse(body || "{}");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ granted: user?.role === "manager" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
}).listen(port, "127.0.0.1");
