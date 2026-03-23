import { Request, Response } from 'express';
import { ResponseUtil } from '../utils/response.utils';

export const notFoundHandler = (req: Request, res: Response) => {
  ResponseUtil.notFound(res, `Route ${req.method} ${req.originalUrl} not found`);
};
