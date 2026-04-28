import { accountDeletionService } from "../services/accountDeletion.service";
import { logger } from "../utils/logger.utils";

export const accountDeletionJob = {
  async run(): Promise<{ processed: number; successful: number; failed: number }> {
    const result = await accountDeletionService.processDueDeletions();
    
    if (result.failed > 0) {
      logger.warn("Some account deletions failed", {
        total: result.total,
        successful: result.successful,
        failed: result.failed,
        failedUsers: result.results.filter(r => !r.success).map(r => ({ userId: r.userId, error: r.error }))
      });
    }
    
    return { 
      processed: result.total, 
      successful: result.successful, 
      failed: result.failed 
    };
  },

  /**
   * Retry failed deletions
   */
  async retryFailed(maxRetries: number = 3): Promise<{ processed: number; successful: number; failed: number }> {
    const result = await accountDeletionService.retryFailedDeletions(maxRetries);
    
    logger.info("Retried failed account deletions", {
      total: result.total,
      successful: result.successful,
      failed: result.failed
    });
    
    return { 
      processed: result.total, 
      successful: result.successful, 
      failed: result.failed 
    };
  },
};

