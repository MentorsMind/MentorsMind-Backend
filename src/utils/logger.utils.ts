// Re-export the pino logger as the canonical logger instance.
// All existing `import { logger } from '../utils/logger.utils'` imports
// continue to work without any changes.
export { logger } from "./logger";
