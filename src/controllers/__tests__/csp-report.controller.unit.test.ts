import { Request, Response } from 'express';
import { CspReportController } from '../csp-report.controller';
import { logger } from '../../utils/logger';

jest.mock('../../utils/logger', () => ({
  logger: {
    warn: jest.fn(),
  },
}));

describe('CspReportController', () => {
  it('logs the CSP violation report and returns 204', () => {
    const request = {
      body: {
        'csp-report': {
          'violated-directive': 'script-src',
          'blocked-uri': 'https://attacker.example/script.js',
          'document-uri': 'https://mentorsmind.example/dashboard',
        },
      },
    } as Request;
    const response = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    } as unknown as Response;

    CspReportController.report(request, response);

    expect(logger.warn).toHaveBeenCalledWith('CSP violation report received', {
      violatedDirective: 'script-src',
      blockedUri: 'https://attacker.example/script.js',
      documentUri: 'https://mentorsmind.example/dashboard',
    });
    expect(response.status).toHaveBeenCalledWith(204);
    expect(response.send).toHaveBeenCalledWith();
  });
});
