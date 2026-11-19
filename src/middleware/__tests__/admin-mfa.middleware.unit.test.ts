import { requireMfa, requireAdminMfa } from '../require-mfa.middleware';
import { stepUpAuth, requireStepUpAuth } from '../step-up-auth.middleware';
import { AdminService } from '../../services/admin.service';

const mockJson = jest.fn();
const mockStatus = jest.fn().mockReturnValue({ json: mockJson });
const mockNext = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockNext.mockReset();
  mockStatus.mockReturnValue({ json: mockJson });
});

describe('Admin MFA enforcement middleware', () => {
  it('rejects admin access when MFA is not enabled', async () => {
    jest.spyOn(AdminService, 'requireAdminMfa').mockResolvedValue({
      allowed: false,
      mfaEnabled: false,
      error: 'Admin MFA required',
    });

    const req: any = {
      user: { id: 'admin-1', role: 'admin', mfaVerified: false },
      method: 'GET',
      originalUrl: '/admin/users',
      ip: '127.0.0.1',
      get: () => 'jest',
    };
    const res: any = { status: mockStatus, json: mockJson };

    await requireMfa(req, res, mockNext);

    expect(mockStatus).toHaveBeenCalledWith(403);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: 'Admin MFA required' }),
    );
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('allows admin traffic when MFA is enabled and verified', async () => {
    jest.spyOn(AdminService, 'requireAdminMfa').mockResolvedValue({
      allowed: true,
      mfaEnabled: true,
    });

    const req: any = {
      user: { id: 'admin-1', role: 'admin', mfaVerified: true },
    };
    const res: any = { status: mockStatus, json: mockJson };

    await requireMfa(req, res, mockNext);

    expect(mockNext).toHaveBeenCalledTimes(1);
  });

  it('returns 428 when a high-risk admin action is missing a step-up code', async () => {
    const req: any = {
      user: { id: 'admin-1', role: 'admin', mfaVerified: false },
      headers: {},
      body: {},
    };
    const res: any = { status: mockStatus, json: mockJson };

    await stepUpAuth(req, res, mockNext);

    expect(mockStatus).toHaveBeenCalledWith(428);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, mfaRequired: true }),
    );
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('accepts a valid step-up code and marks the request as freshly verified', async () => {
    jest.spyOn(AdminService, 'verifyStepUpCode').mockResolvedValue({
      valid: true,
      locked: false,
      attemptsRemaining: 4,
    });

    const req: any = {
      user: { id: 'admin-1', role: 'admin', mfaVerified: false },
      headers: { 'x-mfa-code': '123456' },
      body: {},
    };
    const res: any = { status: mockStatus, json: mockJson };

    await requireStepUpAuth(req, res, mockNext);

    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(req.user.mfaVerified).toBe(true);
  });
});

export {};
