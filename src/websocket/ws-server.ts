import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import {
  authenticateWsConnection,
  AuthenticatedWebSocket,
} from "./ws-auth.middleware";
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

    const socket = ws as AuthenticatedWebSocket;
    socket.userId = auth.userId;
    socket.role = auth.role;
    socket.isAlive = true;

    WsService.addClient(auth.userId, ws);

    ws.send(
      JSON.stringify({ event: "connected", data: { userId: auth.userId } }),
    );

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
      WsService.removeClient(auth.userId, ws);
      logger.debug("WS: client disconnected", { userId: auth.userId });
    });

    ws.on("pong", () => {
      socket.isAlive = true;
    });
  });

  // Heartbeat interval
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      const socket = ws as AuthenticatedWebSocket;
      if (!socket.isAlive) {
        ws.terminate();
        return;
      }
      socket.isAlive = false;
      ws.ping();
    });
  }, 30_000);

  wss.on("close", () => clearInterval(heartbeat));

  logger.info("WebSocket server initialized");
  return wss;
}
