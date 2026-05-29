import { Request, Response } from 'express';

// uuid v13 is pure ESM — mock it so the CJS-only unit test runner can load it.
jest.mock('uuid', () => ({
  v4: () => '00000000-0000-4000-a000-000000000000',
}));

import { correlationIdMiddleware, getCorrelationId } from '../correlation-id.middleware';

describe('correlationIdMiddleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  const headers: Record<string, string> = {};

  beforeEach(() => {
    jest.resetModules();

    mockRequest = {
      headers: {},
    };

    mockResponse = {
      setHeader: jest.fn((key: string, value: string) => {
        headers[key] = value;
        return mockResponse as Response;
      }),
    };
  });

  afterEach(() => {
    Object.keys(headers).forEach((k) => delete headers[k]);
  });

  it('generates a UUID when no X-Correlation-Id header is present', (done) => {
    correlationIdMiddleware(
      mockRequest as Request,
      mockResponse as Response,
      () => {
        // nextFunction is wrapped inside AsyncLocalStorage.run, so we check inside it
        const UUID_REGEX =
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        expect((mockRequest as any).correlationId).toMatch(UUID_REGEX);
        done();
      },
    );
  });

  it('passes through an existing X-Correlation-Id header', (done) => {
    (mockRequest.headers as any)['x-correlation-id'] = 'my-existing-id';

    correlationIdMiddleware(
      mockRequest as Request,
      mockResponse as Response,
      () => {
        expect((mockRequest as any).correlationId).toBe('my-existing-id');
        done();
      },
    );
  });

  it('sets the X-Correlation-Id response header', (done) => {
    (mockRequest.headers as any)['x-correlation-id'] = 'resp-header-id';

    correlationIdMiddleware(
      mockRequest as Request,
      mockResponse as Response,
      () => {
        expect(mockResponse.setHeader).toHaveBeenCalledWith(
          'X-Correlation-Id',
          'resp-header-id',
        );
        done();
      },
    );
  });

  it('makes the correlation ID available via getCorrelationId() inside the request context', (done) => {
    (mockRequest.headers as any)['x-correlation-id'] = 'async-local-id';

    correlationIdMiddleware(
      mockRequest as Request,
      mockResponse as Response,
      () => {
        // We are inside the AsyncLocalStorage context here
        expect(getCorrelationId()).toBe('async-local-id');
        done();
      },
    );
  });

  it('returns undefined from getCorrelationId() outside a request context', () => {
    // Called outside any middleware context
    expect(getCorrelationId()).toBeUndefined();
  });

  it('ignores whitespace-only X-Correlation-Id headers and generates a new ID', (done) => {
    (mockRequest.headers as any)['x-correlation-id'] = '   ';

    const UUID_REGEX =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    correlationIdMiddleware(
      mockRequest as Request,
      mockResponse as Response,
      () => {
        expect((mockRequest as any).correlationId).toMatch(UUID_REGEX);
        done();
      },
    );
  });
});
