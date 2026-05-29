// Mock pg and pg-pool to prevent DB connection attempts from global setup
jest.mock('pg', () => {
  const mPool = {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    end: jest.fn().mockResolvedValue(undefined),
    connect: jest.fn(),
    on: jest.fn(),
  };
  return { Pool: jest.fn(() => mPool) };
});
jest.mock('pg-pool', () => {
  return jest.fn().mockImplementation(() => ({
    query: jest.fn().mockResolvedValue({ rows: [] }),
    end: jest.fn().mockResolvedValue(undefined),
    connect: jest.fn(),
    on: jest.fn(),
  }));
});

import { createServer } from 'http';
import WebSocket from 'ws';
import { initWebSocketServer } from '../ws-server';
import { WsService } from '../../services/ws.service';
import * as wsAuth from '../ws-auth.middleware';

jest.mock('../ws-auth.middleware');
jest.mock('../../services/ws.service', () => ({
  WsService: {
    addClient: jest.fn(),
    removeClient: jest.fn(),
    sendToUser: jest.fn(),
    publish: jest.fn(),
    subscribeToRedis: jest.fn(),
    getConnectedCount: jest.fn().mockReturnValue(0),
    cleanup: jest.fn(),
  },
}));

const mockAuth = wsAuth.authenticateWsConnection as jest.Mock;

function startServer() {
  const httpServer = createServer();
  const wss = initWebSocketServer(httpServer);
  return new Promise<{ httpServer: any; wss: any; port: number }>((resolve) => {
    httpServer.listen(0, () => {
      const port = (httpServer.address() as any).port;
      resolve({ httpServer, wss, port });
    });
  });
}

function closeServer(httpServer: any, wss: any) {
  return new Promise<void>((resolve) => {
    wss.close(() => httpServer.close(() => resolve()));
  });
}

describe('WebSocket Server', () => {
  afterEach(() => jest.clearAllMocks());

  it('rejects unauthenticated connections with code 4001', async () => {
    mockAuth.mockResolvedValue(null);
    const { httpServer, wss, port } = await startServer();

    await new Promise<void>((resolve) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      ws.on('close', (code) => {
        expect(code).toBe(4001);
        resolve();
      });
    });

    await closeServer(httpServer, wss);
  });

  it('accepts authenticated connections and sends connected event', async () => {
    mockAuth.mockResolvedValue({
      userId: 'user-1',
      email: 'a@b.com',
      role: 'mentee',
    });
    const { httpServer, wss, port } = await startServer();

    await new Promise<void>((resolve) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        expect(msg.event).toBe('connected');
        expect(msg.data.userId).toBe('user-1');
        ws.close();
        resolve();
      });
    });

    expect(WsService.addClient).toHaveBeenCalledWith(
      'user-1',
      expect.any(Object),
    );
    await closeServer(httpServer, wss);
  });

  it('responds to ping messages with pong', async () => {
    mockAuth.mockResolvedValue({
      userId: 'user-2',
      email: 'b@c.com',
      role: 'mentor',
    });
    const { httpServer, wss, port } = await startServer();

    await new Promise<void>((resolve) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      let connected = false;
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.event === 'connected' && !connected) {
          connected = true;
          ws.send(JSON.stringify({ event: 'ping' }));
        } else if (msg.event === 'pong') {
          expect(msg.data.ts).toBeDefined();
          ws.close();
          resolve();
        }
      });
    });

    await closeServer(httpServer, wss);
  });

  it('removes client from room on disconnect', async () => {
    mockAuth.mockResolvedValue({
      userId: 'user-3',
      email: 'c@d.com',
      role: 'mentee',
    });
    const { httpServer, wss, port } = await startServer();

    await new Promise<void>((resolve) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.event === 'connected') ws.close();
      });
      ws.on('close', () => {
        setTimeout(() => {
          expect(WsService.removeClient).toHaveBeenCalledWith(
            'user-3',
            expect.any(Object),
          );
          resolve();
        }, 50);
      });
    });

    await closeServer(httpServer, wss);
  });
});
