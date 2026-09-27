import { Request, Response } from 'express';
import { logger } from '../utils/logger';

export const CspReportController = {
  report(req: Request, res: Response): void {
    const report = req.body?.['csp-report'] ?? req.body ?? {};

    logger.warn('CSP violation report received', {
      violatedDirective: report['violated-directive'],
      blockedUri: report['blocked-uri'],
      documentUri: report['document-uri'],
    });

    res.status(204).send();
  },
};
