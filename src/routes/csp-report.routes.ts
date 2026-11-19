import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { CspReportController } from '../controllers/csp-report.controller';

const router = Router();

const cspReportRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post(
  '/',
  cspReportRateLimit,
  express.json({ type: ['application/csp-report', 'application/json'] }),
  CspReportController.report,
);

export default router;
