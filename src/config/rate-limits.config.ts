/**
 * Rate limit configuration system.
 * All windows are in milliseconds. Counts are max requests per window.
 */

export interface RateLimitProfile {
  windowMs: number;
  max: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  message: string;
}

export interface RateLimitConfig {
  /** Applied globally to every request */
  general: RateLimitProfile;
  /** Auth endpoints — stricter to prevent brute-force */
  auth: RateLimitProfile;
  /** Authenticated API endpoints — per user */
  api: RateLimitProfile;
  /** Password reset / sensitive flows */
  sensitive: RateLimitProfile;
  /** Stellar / payment endpoints */
  payment: RateLimitProfile;
  /** Public read-only endpoints */
  public: RateLimitProfile;
  /** Data export endpoints — very strict to prevent abuse */
  export: RateLimitProfile;
}

const rateLimitsConfig: RateLimitConfig = {
  general: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '900000', 10), // 15 min
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS ?? '100', 10),
    message: 'Too many requests from this IP, please try again later.',
  },

  auth: {
    windowMs: 15 * 60 * 1000, // 15 min
    max: 10,
    skipSuccessfulRequests: true,
    message: 'Too many authentication attempts, please try again later.',
  },

  api: {
    windowMs: 60 * 1000, // 1 min
    max: 60,
    message: 'API rate limit exceeded, please slow down.',
  },

  sensitive: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    message: 'Too many sensitive requests, please try again in an hour.',
  },

  payment: {
    windowMs: 60 * 1000, // 1 min
    max: 20,
    message: 'Payment rate limit exceeded, please slow down.',
  },

  public: {
    windowMs: 60 * 1000, // 1 min
    max: 120,
    message: 'Public rate limit exceeded, please slow down.',
  },

  export: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3,
    message: 'Export rate limit exceeded. Maximum 3 export requests per hour.',
  },
};

export default rateLimitsConfig;
