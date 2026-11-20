import * as admin from "firebase-admin";
import { logger } from "../utils/logger.utils";
import { PushTokensModel } from "../models/push-tokens.model";
import { pushTokenInvalidTotal } from "../config/metrics";

/**
 * Validate push tokens in batches using FCM multicast send responses.
 * Removes invalid tokens detected by FCM.
 */
export async function runPushTokenCleanupJob(): Promise<{
  processed: number;
  removed: number;
}> {
  if (admin.apps.length === 0) {
    logger.warn("[PushTokenCleanupJob] Firebase not initialized — skipping");
    return { processed: 0, removed: 0 };
  }

  const BATCH_SIZE = 500; // FCM limit per multicast
  let offset = 0;
  let processed = 0;
  let removed = 0;

  while (true) {
    const batch = await PushTokensModel.getActiveTokensBatch(
      BATCH_SIZE,
      offset,
    );
    if (!batch || batch.length === 0) break;

    const tokens = batch.map((r) => r.token);

    const message: admin.messaging.MulticastMessage = {
      tokens,
      data: { validation: "1" },
    };

    try {
      const response = await admin.messaging().sendEachForMulticast(message);

      response.responses.forEach((resp, idx) => {
        processed += 1;
        if (!resp.success) {
          const error = resp.error;
          if (
            error?.code === "messaging/invalid-registration-token" ||
            error?.code === "messaging/registration-token-not-registered"
          ) {
            const token = tokens[idx];
            PushTokensModel.deleteByToken(token).catch((err) => {
              logger.error("[PushTokenCleanupJob] Failed deleting token", {
                token,
                error: err,
              });
            });
            removed += 1;
            try {
              pushTokenInvalidTotal.inc({ reason: error.code });
            } catch (e) {
              logger.debug("[PushTokenCleanupJob] Failed incrementing metric", {
                error: e,
              });
            }
          }
        }
      });
    } catch (err) {
      logger.error("[PushTokenCleanupJob] Batch validation failed", {
        error: err,
      });
    }

    // Progress to next batch
    offset += BATCH_SIZE;
  }

  logger.info("[PushTokenCleanupJob] Completed", { processed, removed });
  return { processed, removed };
}
