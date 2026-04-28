import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { authenticateWsConnection } from "./ws-auth.middleware";
import { WsService } from "../services/ws.service";
import { logger } from "../utils/logger.utils";

export function initWebSocketServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", async (ws: WebSocket, req) => {
    const auth = await authenticateWsConnection(req);
    if (!auth) {
      ws.close(4001, "Unauthorized");
      return;
    }

    const { userId } = auth;
    WsService.addClient(userId, ws);

    ws.send(JSON.stringify({ event: "connected", data: { userId } }));

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.event === "ping") {
          ws.send(JSON.stringify({ event: "pong", data: { ts: Date.now() } }));
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on("close", () => {
      WsService.removeClient(userId, ws);
      logger.debug({ userId }, "WS: client disconnected");
    });

    ws.on("error", (err) => {
      logger.warn({ userId, error: err.message }, "WS: socket error");
    });
  });

  return wss;
}
