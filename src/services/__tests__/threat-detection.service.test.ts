/// <reference types="jest" />
import { ThreatDetectionService } from '../threat-detection.service';
import { AccessRiskModel } from '../../models/access-risk.model';
import { LoginAttemptsService } from '../loginAttempts.service';

jest.mock('../../models/access-risk.model', () => ({
  AccessRiskModel: {
    getRecentForUser: jest.fn(),
    countDistinctIpsSince: jest.fn(),
  },
}));

jest.mock('../loginAttempts.service', () => ({
  LoginAttemptsService: {
    getStatus: jest.fn(),
  },
}));

// Baseline defaults mirror the old hardcoded scoreDeviation() sample set the
// tests were written against, so behavior stays deterministic here.
jest.mock('../baseline-store.service', () => ({
  BaselineStore: {
    getSamples: jest.fn().mockResolvedValue([0, 1, 1, 1, 2]),
  },
}));

describe('ThreatDetectionService.analyzeLoginEvent', () => {
  const userId = 'user-1';
  const baseContext = {
    ip: '1.2.3.4',
    userAgent: 'jest-test',
    timestamp: new Date('2026-08-24T12:00:00Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns no threat for quiet, normal activity', async () => {
    (AccessRiskModel.getRecentForUser as jest.Mock).mockResolvedValue([]);
    (AccessRiskModel.countDistinctIpsSince as jest.Mock).mockResolvedValue(1);
    (LoginAttemptsService.getStatus as jest.Mock).mockResolvedValue({
      locked: false,
      permanent: false,
      attempts: 0,
      captchaRequired: false,
    });

    const result = await ThreatDetectionService.analyzeLoginEvent(userId, {
      ...baseContext,
      email: 'user@example.com',
    });

    expect(result.threatDetected).toBe(false);
    expect(result.score).toBeLessThan(40);
  });

  it('flags a threat for high login velocity + IP diversity spike', async () => {
    const now = baseContext.timestamp.getTime();
    const manyRecentRows = Array.from({ length: 12 }, (_, i) => ({
      id: `row-${i}`,
      user_id: userId,
      ip_address: `10.0.0.${i}`,
      user_agent: 'x',
      device_fingerprint: null,
      risk_score: 10,
      decision: 'allow',
      resource: '/login',
      created_at: new Date(now - i * 60_000),
    }));

    (AccessRiskModel.getRecentForUser as jest.Mock).mockResolvedValue(manyRecentRows);
    (AccessRiskModel.countDistinctIpsSince as jest.Mock).mockResolvedValue(9);
    (LoginAttemptsService.getStatus as jest.Mock).mockResolvedValue({
      locked: false,
      permanent: false,
      attempts: 0,
      captchaRequired: false,
    });

    const result = await ThreatDetectionService.analyzeLoginEvent(userId, {
      ...baseContext,
      email: 'user@example.com',
    });

    expect(result.threatDetected).toBe(true);
    expect(result.severity).toBeDefined();
    expect(['low', 'medium', 'high', 'critical']).toContain(result.severity);
    expect(result.incidentType).toBeDefined();
  });

  it('flags a credential-stuffing-style incident for heavy failed attempts', async () => {
    (AccessRiskModel.getRecentForUser as jest.Mock).mockResolvedValue([]);
    (AccessRiskModel.countDistinctIpsSince as jest.Mock).mockResolvedValue(1);
    (LoginAttemptsService.getStatus as jest.Mock).mockResolvedValue({
      locked: true,
      permanent: false,
      attempts: 18,
      captchaRequired: true,
    });

    const result = await ThreatDetectionService.analyzeLoginEvent(userId, {
      ...baseContext,
      email: 'attacked@example.com',
    });

    expect(result.threatDetected).toBe(true);
    expect(result.incidentType).toBe('credential_stuffing_pattern');
  });

  it('does not query LoginAttemptsService when no email is provided', async () => {
    (AccessRiskModel.getRecentForUser as jest.Mock).mockResolvedValue([]);
    (AccessRiskModel.countDistinctIpsSince as jest.Mock).mockResolvedValue(1);

    await ThreatDetectionService.analyzeLoginEvent(userId, baseContext);

    expect(LoginAttemptsService.getStatus).not.toHaveBeenCalled();
  });
});
