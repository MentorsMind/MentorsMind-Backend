import { Request, Response, NextFunction } from 'express';
import { cacheMiddleware } from '../../middleware/cache.middleware';
import { CacheService } from '../../services/cache.service';

jest.mock('../../services/cache.service');

const mockCacheService = CacheService as jest.Mocked<typeof CacheService>;

describe('cacheMiddleware with cacheAuthenticated: true', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;
  let setHeaderMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jsonMock = jest.fn().mockReturnThis();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    setHeaderMock = jest.fn();
    mockRes = {
      status: statusMock,
      json: jsonMock,
      setHeader: setHeaderMock,
      statusCode: 200,
    };
    mockNext = jest.fn();
  });

  it('should include userId in cache key when cacheAuthenticated is true', async () => {
    mockReq = {
      method: 'GET',
      originalUrl: '/api/v1/users/me',
      user: { userId: 'user-123', email: 'test@example.com', role: 'user' },
    } as any;

    mockCacheService.get.mockResolvedValue(null);
    mockCacheService.set.mockResolvedValue(undefined);

    const middleware = cacheMiddleware({ cacheAuthenticated: true, ttl: 60 });
    await middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockCacheService.get).toHaveBeenCalledWith('mm:http:user-123:/api/v1/users/me');
  });

  it('should use different cache keys for different users on the same URL', async () => {
    const user1Req = {
      method: 'GET',
      originalUrl: '/api/v1/users/me',
      user: { userId: 'user-1', email: 'user1@example.com', role: 'user' },
    } as any;

    const user2Req = {
      method: 'GET',
      originalUrl: '/api/v1/users/me',
      user: { userId: 'user-2', email: 'user2@example.com', role: 'user' },
    } as any;

    mockCacheService.get.mockResolvedValue(null);
    mockCacheService.set.mockResolvedValue(undefined);

    const middleware = cacheMiddleware({ cacheAuthenticated: true, ttl: 60 });

    await middleware(user1Req as Request, mockRes as Response, mockNext);
    const key1 = mockCacheService.get.mock.calls[0][0];

    jest.clearAllMocks();
    mockCacheService.get.mockResolvedValue(null);

    await middleware(user2Req as Request, mockRes as Response, mockNext);
    const key2 = mockCacheService.get.mock.calls[0][0];

    expect(key1).toBe('mm:http:user-1:/api/v1/users/me');
    expect(key2).toBe('mm:http:user-2:/api/v1/users/me');
    expect(key1).not.toBe(key2);
  });

  it('should not cache when cacheAuthenticated is true but user is missing', async () => {
    mockReq = {
      method: 'GET',
      originalUrl: '/api/v1/users/me',
    } as any;

    const middleware = cacheMiddleware({ cacheAuthenticated: true, ttl: 60 });
    await middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockCacheService.get).not.toHaveBeenCalled();
  });

  it('should allow custom keyFn to override default user-scoped key', async () => {
    mockReq = {
      method: 'GET',
      originalUrl: '/api/v1/users/me',
      user: { userId: 'user-123', email: 'test@example.com', role: 'user' },
    } as any;

    mockCacheService.get.mockResolvedValue(null);
    mockCacheService.set.mockResolvedValue(undefined);

    const customKeyFn = (req: Request) => `custom:${(req as any).user.userId}:${req.originalUrl}`;
    const middleware = cacheMiddleware({ cacheAuthenticated: true, ttl: 60, keyFn: customKeyFn });
    await middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockCacheService.get).toHaveBeenCalledWith('custom:user-123:/api/v1/users/me');
  });

  it('should not include userId when cacheAuthenticated is false', async () => {
    mockReq = {
      method: 'GET',
      originalUrl: '/api/v1/mentors',
      user: { userId: 'user-123', email: 'test@example.com', role: 'user' },
    } as any;

    const middleware = cacheMiddleware({ cacheAuthenticated: false, ttl: 60 });
    await middleware(mockReq as Request, mockRes as Response, mockNext);

    // Should skip caching for authenticated requests when cacheAuthenticated is false
    expect(mockNext).toHaveBeenCalled();
    expect(mockCacheService.get).not.toHaveBeenCalled();
  });
});
