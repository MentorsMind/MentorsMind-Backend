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

import { IncomingMessage } from 'http';
import { Socket } from 'net';
import { authenticateWsConnection } from '../ws-auth.middleware';
import { JwtUtils } from '../../utils/jwt.utils';
import { TokenService } from '../../services/token.service';

jest.mock('../../utils/jwt.utils');
jest.mock('../../services/token.service', () => ({
  TokenService: {
    isTokenBlacklisted: jest.fn(),
  },
}));

const mockVerify = JwtUtils.verifyAccessToken as jest.Mock;
const mockBlacklist = TokenService.isTokenBlacklisted as jest.Mock;

function makeRequest(
  url: string,
  headers: Record<string, string> = {},
): IncomingMessage {
  const req = new IncomingMessage(new Socket());
  req.url = url;
  req.headers = { host: 'localhost', ...headers };
  return req;
}

describe('authenticateWsConnection', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns null when no token is provided', async () => {
    const result = await authenticateWsConnection(makeRequest('/ws'));
    expect(result).toBeNull();
  });

  it('authenticates via query param token', async () => {
    mockVerify.mockReturnValue({
      userId: 'u1',
      email: 'a@b.com',
      role: 'mentee',
      jti: 'jti1',
    });
    mockBlacklist.mockResolvedValue(false);

    const result = await authenticateWsConnection(
      makeRequest('/ws?token=valid.jwt.token'),
    );
    expect(result).toEqual({ userId: 'u1', email: 'a@b.com', role: 'mentee' });
  });

  it('authenticates via Sec-WebSocket-Protocol header', async () => {
    mockVerify.mockReturnValue({
      userId: 'u2',
      email: 'b@c.com',
      role: 'mentor',
      jti: 'jti2',
    });
    mockBlacklist.mockResolvedValue(false);

    const result = await authenticateWsConnection(
      makeRequest('/ws', {
        'sec-websocket-protocol': 'Bearer valid.jwt.token',
      }),
    );
    expect(result).toEqual({ userId: 'u2', email: 'b@c.com', role: 'mentor' });
  });

  it('returns null for blacklisted tokens', async () => {
    mockVerify.mockReturnValue({
      userId: 'u3',
      email: 'c@d.com',
      role: 'mentee',
      jti: 'jti3',
    });
    mockBlacklist.mockResolvedValue(true);

    const result = await authenticateWsConnection(
      makeRequest('/ws?token=blacklisted.token'),
    );
    expect(result).toBeNull();
  });

  it('returns null when token verification throws', async () => {
    mockVerify.mockImplementation(() => {
      throw new Error('invalid signature');
    });

    const result = await authenticateWsConnection(
      makeRequest('/ws?token=bad.token'),
    );
    expect(result).toBeNull();
  });
});
