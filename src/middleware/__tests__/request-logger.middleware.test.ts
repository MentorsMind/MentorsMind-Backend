import { Request, Response, NextFunction } from 'express';
import { requestLoggerMiddleware } from '../request-logger.middleware';
import { logger } from '../../utils/logger';

// ---------------------------------------------------------------------------
// Mock the logger so we can assert on its method calls without any I/O
// ---------------------------------------------------------------------------
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('requestLoggerMiddleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;
  const finishListeners: Array<() => void> = [];

  beforeEach(() => {
    jest.clearAllMocks();
    finishListeners.length = 0;

    mockRequest = {
      method: 'GET',
      originalUrl: '/api/v1/users',
      ip: '127.0.0.1',
      correlationId: 'test-corr-id',
      get: jest.fn().mockReturnValue('TestAgent/1.0'),
    };

    mockResponse = {
      statusCode: 200,
      on: jest.fn((event: string, cb: () => void) => {
        if (event === 'finish') finishListeners.push(cb);
        return mockResponse as Response;
      }),
    };

    nextFunction = jest.fn();
  });

  it('logs an incoming request with method, url, correlationId, ip', () => {
    requestLoggerMiddleware(
      mockRequest as Request,
      mockResponse as Response,
      nextFunction,
    );

    expect(mockedLogger.info).toHaveBeenCalledWith(
      'Incoming request',
      expect.objectContaining({
        correlationId: 'test-corr-id',
        method: 'GET',
        url: '/api/v1/users',
        ip: '127.0.0.1',
      }),
    );
  });

  it('calls next()', () => {
    requestLoggerMiddleware(
      mockRequest as Request,
      mockResponse as Response,
      nextFunction,
    );
    expect(nextFunction).toHaveBeenCalled();
  });

  it('logs response using logger.info for 2xx status', () => {
    mockResponse.statusCode = 200;
    requestLoggerMiddleware(
      mockRequest as Request,
      mockResponse as Response,
      nextFunction,
    );

    // Trigger the finish event
    finishListeners.forEach((fn) => fn());

    expect(mockedLogger.info).toHaveBeenCalledWith(
      'Request completed',
      expect.objectContaining({
        correlationId: 'test-corr-id',
        method: 'GET',
        url: '/api/v1/users',
        statusCode: 200,
      }),
    );
    // durationMs should be a number
    const callArgs = (mockedLogger.info as jest.Mock).mock.calls[1][1];
    expect(typeof callArgs.durationMs).toBe('number');
  });

  it('logs response using logger.warn for 4xx status', () => {
    mockResponse.statusCode = 404;
    requestLoggerMiddleware(
      mockRequest as Request,
      mockResponse as Response,
      nextFunction,
    );
    finishListeners.forEach((fn) => fn());

    expect(mockedLogger.warn).toHaveBeenCalledWith(
      'Request completed with client error',
      expect.objectContaining({ statusCode: 404 }),
    );
  });

  it('logs response using logger.error for 5xx status', () => {
    mockResponse.statusCode = 500;
    requestLoggerMiddleware(
      mockRequest as Request,
      mockResponse as Response,
      nextFunction,
    );
    finishListeners.forEach((fn) => fn());

    expect(mockedLogger.error).toHaveBeenCalledWith(
      'Request completed with server error',
      expect.objectContaining({ statusCode: 500 }),
    );
  });

  it('includes correlationId from req in all response log entries', () => {
    mockResponse.statusCode = 201;
    requestLoggerMiddleware(
      mockRequest as Request,
      mockResponse as Response,
      nextFunction,
    );
    finishListeners.forEach((fn) => fn());

    const callArgs = (mockedLogger.info as jest.Mock).mock.calls[1][1];
    expect(callArgs.correlationId).toBe('test-corr-id');
  });
});
