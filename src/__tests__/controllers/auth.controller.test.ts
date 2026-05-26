import { Request, Response } from 'express';
import { AuthController } from '../../controllers/auth.controller';
import { AuthService } from '../../services/auth.service';
import { AuditLogService } from '../../services/auditLog.service';
import { LoginAttemptsService } from '../../services/loginAttempts.service';

jest.mock('../../services/auth.service');
jest.mock('../../services/auditLog.service');
jest.mock('../../services/loginAttempts.service');
jest.mock('../../validators/auth.validator', () => ({
  forgotPasswordSchema: { parse: jest.fn() },
  registerSchema: { parse: jest.fn() },
  loginSchema: { parse: jest.fn(), safeParse: jest.fn() },
  resetPasswordSchema: { parse: jest.fn() },
  refreshTokenSchema: { parse: jest.fn() },
}));

import {
  forgotPasswordSchema,
} from '../../validators/auth.validator';

const mockAuthService = AuthService as jest.Mocked<typeof AuthService>;
const mockForgotPasswordSchema = forgotPasswordSchema as jest.Mocked<typeof forgotPasswordSchema>;

describe('AuthController.forgotPassword', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jsonMock = jest.fn().mockReturnThis();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    mockRes = { status: statusMock, json: jsonMock };
    mockReq = { body: { email: 'user@example.com' } };

    (mockForgotPasswordSchema.parse as jest.Mock).mockReturnValue({
      body: { email: 'user@example.com' },
    });
  });

  it('should not include token in response body', async () => {
    mockAuthService.forgotPassword.mockResolvedValue('some-secret-token');

    await AuthController.forgotPassword(mockReq as Request, mockRes as Response);

    expect(statusMock).toHaveBeenCalledWith(200);
    const responseBody = jsonMock.mock.calls[0][0];
    expect(responseBody).not.toHaveProperty('data');
    expect(JSON.stringify(responseBody)).not.toContain('token');
    expect(responseBody.success).toBe(true);
    expect(responseBody.message).toBeDefined();
  });

  it('should return success message even when email does not exist', async () => {
    mockAuthService.forgotPassword.mockResolvedValue('');

    await AuthController.forgotPassword(mockReq as Request, mockRes as Response);

    expect(statusMock).toHaveBeenCalledWith(200);
    const responseBody = jsonMock.mock.calls[0][0];
    expect(responseBody.success).toBe(true);
    expect(responseBody).not.toHaveProperty('data');
  });
});
