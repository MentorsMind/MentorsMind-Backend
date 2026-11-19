import { createServer } from "node:http";
import { createSecurityTestApp } from "./app";

const port = Number(process.env.SECURITY_TEST_PORT ?? 5050);
const server = createServer(createSecurityTestApp());

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Security DAST target listening on http://127.0.0.1:${port}\n`);
});

function shutdown(): void {
  server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);