import { Request, Response } from 'express';
import { notFoundHandler } from '../notFoundHandler';
import { ErrorCode } from '../../errors/error-codes';

describe('notFoundHandler', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });

    mockRequest = {
      method: 'GET',
      originalUrl: '/api/v1/nonexistent',
      headers: {},
    };

    mockResponse = {
      status: statusMock,
      locals: {},
    };
    
    // Mock Date.prototype.toISOString to return a fixed timestamp
    jest.useFakeTimers().setSystemTime(new Date('2026-09-25T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should return a standardized 404 response with NOT_FOUND code', () => {
    notFoundHandler(mockRequest as Request, mockResponse as Response);

    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({
      status: 'error',
      code: ErrorCode.NOT_FOUND,
      message: 'Route GET /api/v1/nonexistent not found',
      timestamp: '2026-09-25T00:00:00.000Z',
    });
  });

  it('should include requestId from res.locals if present', () => {
    mockResponse.locals = { requestId: 'local-req-123' };

    notFoundHandler(mockRequest as Request, mockResponse as Response);

    expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'local-req-123',
    }));
  });

  it('should fallback to requestId from headers if res.locals is empty', () => {
    mockRequest.headers = { 'x-request-id': 'header-req-456' };

    notFoundHandler(mockRequest as Request, mockResponse as Response);

    expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'header-req-456',
    }));
  });
});
