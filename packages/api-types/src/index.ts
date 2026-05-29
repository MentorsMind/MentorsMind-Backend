/**
 * TypeScript types for MentorMinds API
 * Auto-generated from OpenAPI specification
 * 
 * To regenerate: npm run generate:types
 */

// Common response types
export interface ApiResponse<T = any> {
  status: 'success' | 'error' | 'fail';
  message?: string;
  data?: T;
  error?: string;
  timestamp: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total?: number;
  totalPages?: number;
  hasMore?: boolean;
}

export interface PaginatedResponse<T> extends ApiResponse<T> {
  meta?: PaginationMeta;
}

// Auth types
export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role?: 'mentee' | 'mentor';
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

// User types
export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'mentee' | 'mentor' | 'admin';
  bio?: string | null;
  avatarUrl?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicUser {
  id: string;
  firstName: string;
  lastName: string;
  role: 'mentee' | 'mentor';
  bio?: string | null;
  avatarUrl?: string | null;
}

export interface UpdateUserRequest {
  firstName?: string;
  lastName?: string;
  bio?: string;
  avatarUrl?: string;
}

// Mentor types
export interface MentorProfile {
  id: string;
  userId: string;
  headline?: string;
  bio?: string;
  skills: string[];
  hourlyRate: number;
  currency: string;
  timezone: string;
  linkedinUrl?: string | null;
  githubUrl?: string | null;
  websiteUrl?: string | null;
}

// Session/Booking types
export interface Session {
  id: string;
  mentorId: string;
  menteeId: string;
  scheduledAt: string;
  durationMinutes: number;
  topic: string;
  notes?: string | null;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  meetingUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionRequest {
  mentorId: string;
  scheduledAt: string;
  durationMinutes: number;
  topic: string;
  notes?: string;
}

// Wallet types
export interface WalletInfo {
  stellarAddress: string;
  balances: Array<{
    assetCode: string;
    balance: string;
  }>;
}

export interface LinkWalletRequest {
  stellarAddress: string;
}

// Notification types
export interface Notification {
  id: string;
  userId: string;
  type: string;
  channel: string;
  priority: string;
  title: string;
  message: string;
  data: Record<string, any>;
  isRead: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PushSubscribeRequest {
  token: string;
  deviceType?: 'web' | 'android' | 'ios';
  deviceId?: string;
}

export interface PushToken {
  id: string;
  deviceType?: string;
  deviceId?: string;
  lastUsedAt: string;
  createdAt: string;
}

// Admin types
export interface AdminStats {
  totalUsers: number;
  totalMentors: number;
  totalSessions: number;
  totalTransactions: number;
  activeDisputes: number;
}

// Health check types
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  checks: {
    database: { status: string; responseTime?: number };
    redis: { status: string; responseTime?: number };
    stellar: { status: string; responseTime?: number };
  };
}

// Helper type for API endpoints
export type ApiEndpoint<
  Path extends string,
  Method extends 'get' | 'post' | 'put' | 'delete' | 'patch'
> = {
  path: Path;
  method: Method;
};
