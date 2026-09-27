import { Request } from 'express';

export interface RegisterBody {
  name: string;
  email: string;
  password: string;
  role: 'mentor' | 'mentee';
}

export interface LoginBody {
  email: string;
  password: string;
}

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    stellarPublicKey?: string;
    createdAt: string;
  };
  token: string;
  refreshToken: string;
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    userId: string;
    email?: string;
    role: string;
    mfaVerified?: boolean;
    /** Set to true when this request is authenticated via an impersonation token */
    isImpersonation?: boolean;
    /** The admin user ID who initiated the impersonation */
    impersonatedBy?: string;
    /** The impersonation session ID — used for revocation checks */
    impersonationSessionId?: string;
  };
}
