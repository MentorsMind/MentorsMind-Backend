import crypto from "crypto";

/**
 * Cache key utilities.
 * All keys follow the pattern: mm:<resource>:<identifier>[:<qualifier>]
 */

/**
 * Generate a hash of query parameters for cache key
 * @param params - Object containing query parameters
 * @returns Short hash string
 */
function hashParams(params: Record<string, any>): string {
  const json = JSON.stringify(params);
  return crypto.createHash("md5").update(json).digest("hex").substring(0, 8);
}

export const CacheKeys = {
  // User cache keys
  user: (id: string) => `mm:user:${id}`,
  userPublic: (id: string) => `mm:user:${id}:public`,

  // Mentor cache keys
  mentorProfile: (id: string) => `mm:mentor:${id}`,
  mentorList: (page: number, limit: number) => `mm:mentors:${page}:${limit}`,
  /**
   * Cache key for mentor search results (used by MentorsService.list)
   * Uses hash of query parameters to create compact, unique keys
   * @example CacheKeys.mentorSearch({ search: 'John', expertise: 'React', minRate: 50 })
   */
  mentorSearch: (params: Record<string, any>) => `mm:mentors:list:v1:${hashParams(params)}`,

  // Session cache keys
  /**
   * Cache key for user's session list
   * @param userId - User ID
   */
  sessionList: (userId: string) => `mm:sessions:${userId}`,

  // Stellar/Wallet cache keys
  /**
   * Cache key for Stellar account balance
   * @param publicKey - Stellar public key (G...)
   */
  stellarBalance: (publicKey: string) => `mm:balance:${publicKey}`,
  /**
   * Cache key for Stellar asset balance
   * @param publicKey - Stellar public key
   * @param assetCode - Asset code (e.g., 'XLM', 'USD')
   * @param assetIssuer - Asset issuer (optional)
   */
  stellarAssetBalance: (
    publicKey: string,
    assetCode: string,
    assetIssuer?: string,
  ) =>
    `mm:balance:${publicKey}:${assetCode}${assetIssuer ? `:${assetIssuer}` : ""}`,

  // Recommendation cache keys
  recommendations: (learnerId: string) => `mm:recommendations:${learnerId}`,

  // Admin cache keys
  adminStats: () => `mm:admin:stats`,
  systemHealth: () => `mm:admin:health`,
} as const;

/** TTL presets in seconds */
export const CacheTTL: Record<string, number> = {
  veryShort: 30, // 30 seconds — Stellar balances, frequently changing data
  short: 60, // 1 min — mentor search results, session lists
  medium: 300, // 5 min — user profiles, mentor lists
  long: 3600, // 1 hour — stats, config
  veryLong: 86400, // 1 day — rarely changing data
};

/** Tags used for group invalidation */
export const CacheTags = {
  user: (id: string) => `tag:user:${id}`,
  mentors: () => `tag:mentors`,
  mentorProfile: (id: string) => `tag:mentor:${id}`,
  sessions: (userId: string) => `tag:sessions:${userId}`,
  stellar: (publicKey: string) => `tag:stellar:${publicKey}`,
  admin: () => `tag:admin`,
} as const;
