import { Request, Response, NextFunction } from 'express';

export const asyncHandler = <Req extends Request = Request>(
  fn: (req: Req, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as any, res, next)).catch((err) => {
      // Guard against ERR_HTTP_HEADERS_SENT: if the handler already wrote a
      // response (e.g. via an early return after res.json()) and then threw,
      // calling next(err) would trigger Express's error handler which tries to
      // write another response. Skip forwarding in that case.
      if (!res.headersSent) next(err);
    });
  };
};
