import { Request, Response, NextFunction } from 'express';
import { noCacheMiddleware } from '../no-cache.middleware';

describe('noCacheMiddleware', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    req = {};
    res = {
      setHeader: jest.fn(),
    };
    next = jest.fn();
  });

  it('should set Cache-Control and Pragma headers to prevent caching', () => {
    noCacheMiddleware(req as Request, res as Response, next);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store, no-cache, private',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
