import { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import { URL } from 'url';
import { JwtUtils } from '../utils/jwt.utils';
import { TokenService } from '../services/token.service';
import { logger } from '../utils/logger.utils';

export interface WsAuthPayload {
  userId: string;
  email: string;
  role: string;
}

export interface AuthenticatedWebSocket extends WebSocket {
  userId: string;
  role: string;
  isAlive: boolean;
}

/**
 * Authenticates a WebSocket upgrade request.
 *
 * Clients can pass the JWT in two ways:
 *   1. Query param:  ws://host/ws?token=<jwt>
 *   2. Sec-WebSocket-Protocol header (Bearer <jwt>)
 *
 * Returns null if authentication fails.
 */
export async function authenticateWsConnection(
  req: IncomingMessage,
): Promise<WsAuthPayload | null> {
  try {
    const token = extractToken(req);
    if (!token) return null;

    const decoded = JwtUtils.verifyAccessToken(token);

    // Reject blacklisted tokens
    const blacklisted = await TokenService.isTokenBlacklisted(decoded.jti);
    if (blacklisted) {
      logger.warn('WS auth: blacklisted token', { jti: decoded.jti });
      return null;
    }

    return {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
    };
  } catch (err: any) {
    logger.warn('WS auth: token verification failed', { error: err.message });
    return null;
  }
}

function extractToken(req: IncomingMessage): string | null {
  // 1. Query string: /ws?token=<jwt>
  const host = `ws://${req.headers.host ?? 'localhost'}`;
  try {
    const url = new URL(req.url ?? '/', host);
    const qToken = url.searchParams.get('token');
    if (qToken) return qToken;
  } catch {
    // ignore URL parse errors
  }

  // 2. Sec-WebSocket-Protocol: Bearer <jwt>
  const proto = req.headers['sec-websocket-protocol'];
  if (proto) {
    const parts = proto.split(',').map((p) => p.trim());
    for (const part of parts) {
      if (part.startsWith('Bearer ')) return part.slice(7);
    }
  }

  return null;
}
