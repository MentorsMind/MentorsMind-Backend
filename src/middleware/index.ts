/**
 * Middleware Index
 * 
 * Centralized export of all middleware for easy importing
 * and consistent application across the application
 */

export { errorHandler, createError } from "./errorHandler";
export {
  deprecationMiddleware,
  sunsetWarningMiddleware,
  deprecationTrackingMiddleware,
  strictDeprecationMiddleware,
  deprecationInfoMiddleware,
} from "./deprecation.middleware";
export { versioningMiddleware } from "./versioning.middleware";
export {
  apiSunsetEnforcementMiddleware,
  isCriticalSunsetPeriod,
  isSunset,
  getCriticalSunsetVersions,
  getVersionSunsetStatus,
} from "./api-sunset-enforcement.middleware";
