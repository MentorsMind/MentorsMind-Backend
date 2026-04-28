import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import {
  authenticateWsConnection,
  AuthenticatedWebSocket,
} from "./ws-auth.middleware";
import {
  handleSessionRoomMessage,
  isSessionRoomEvent,
  removeFromRoom,
} from "./ws-handlers/session-room.handler";
import { WsService } from "../services/ws.service";
import { logger } from "../utils/logger.utils";

export function initWebSocketServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", async (ws: WebSocket, req) => {
    const authResult = await authenticateWsConnection(req);

    if (!authResult) {
      ws.close(4001, "Unauthorized");
      return;
    }

    const client = ws as AuthenticatedWebSocket;
    client.userId = authResult.userId;
    client.role = authResult.role;
    client.isAlive = true;

    WsService.addClient(authResult.userId, client);

    client.send(
      JSON.stringify({
        event: "connected",
        data: { userId: authResult.userId, role: authResult.role },
      }),
    );

    client.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.event === "ping") {
          client.send(
            JSON.stringify({ event: "pong", data: { ts: Date.now() } }),
          );
          return;
        }
        if (isSessionRoomEvent(msg.event)) {
          await handleSessionRoomMessage(client, msg);
        }
      } catch (err) {
        logger.warn("WS: failed to parse message", { err });
      }
    });

    client.on("close", () => {
      removeFromRoom(client);
      WsService.removeClient(authResult.userId, client);
    });

    logger.info("WS: client connected", { userId: authResult.userId });
  });

  return wss;
}
