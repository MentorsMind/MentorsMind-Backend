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

  // Learning Path cache keys
  learningPath: (pathId: string) => `mm:learning_path:${pathId}`,
  mentorPaths: (mentorId: string) => `mm:mentor:${mentorId}:paths`,
  publishedPaths: () => `mm:learning_paths:published`,
  pathEnrollments: (pathId: string) => `mm:path:${pathId}:enrollments`,
  studentEnrollments: (studentId: string) => `mm:student:${studentId}:enrollments`,
  studentProgress: (studentId: string, pathId: string) => `mm:student:${studentId}:progress:${pathId}`,
  enrollmentProgress: (enrollmentId: string) => `mm:enrollment:${enrollmentId}:progress`,
  pathAnalytics: (pathId: string) => `mm:path:${pathId}:analytics`,
  milestoneProgress: (enrollmentId: string, milestoneId: string) => `mm:milestone:${enrollmentId}:${milestoneId}:progress`,
  pathTemplates: () => `mm:learning_paths:templates`,
  pathsByDifficulty: (difficulty: string) => `mm:learning_paths:difficulty:${difficulty}`,
  pathsByTags: (tags: string) => `mm:learning_paths:tags:${hashParams({ tags })}`,
  prerequisiteValidation: (studentId: string, milestoneId: string) => `mm:prerequisite:${studentId}:${milestoneId}`,
  
  // Session-Milestone Integration cache keys
  sessionContext: (bookingId: string) => `mm:session:${bookingId}:context`,
  learningPathContext: (mentorId: string, studentId: string) => `mm:context:${mentorId}:${studentId}`,
  sessionOutcome: (bookingId: string) => `mm:session:${bookingId}:outcome`,
  milestoneSessionOutcomes: (milestoneId: string) => `mm:milestone:${milestoneId}:outcomes`,
  bookingRecommendations: (mentorId: string, studentId: string) => `mm:recommendations:${mentorId}:${studentId}`,
  hybridModeConfig: (mentorId: string) => `mm:mentor:${mentorId}:hybrid_config`,
  sessionMilestoneMapping: (bookingId: string) => `mm:session:${bookingId}:milestone`,
  milestoneAvailableSessions: (milestoneId: string) => `mm:milestone:${milestoneId}:sessions`,
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
  
  // Learning Path cache tags
  learningPaths: () => `tag:learning_paths`,
  learningPath: (pathId: string) => `tag:learning_path:${pathId}`,
  mentorPaths: (mentorId: string) => `tag:mentor:${mentorId}:paths`,
  studentEnrollments: (studentId: string) => `tag:student:${studentId}:enrollments`,
  pathEnrollments: (pathId: string) => `tag:path:${pathId}:enrollments`,
  
  // Session-Milestone Integration cache tags
  sessionMilestone: (bookingId: string) => `tag:session:${bookingId}:milestone`,
  milestoneSession: (milestoneId: string) => `tag:milestone:${milestoneId}:sessions`,
  sessionOutcomes: (milestoneId: string) => `tag:milestone:${milestoneId}:outcomes`,
  hybridMode: (mentorId: string) => `tag:mentor:${mentorId}:hybrid`,
} as const;
