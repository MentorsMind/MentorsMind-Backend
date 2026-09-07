import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { accountDeletionService } from '../services/accountDeletion.service';

// Blockchain data notice – immutable on‑chain escrow data cannot be removed.
const BLOCKCHAIN_DATA_NOTICE =
  'On‑chain Stellar escrow data referencing your public key cannot be deleted because blockchain entries are immutable. The on‑chain data includes certificate hashes and escrow contracts.';

/**
 * POST /api/v1/account/delete
 * Triggers GDPR right‑to‑erasure request for the authenticated user.
 */
export async function requestAccountDeletion(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const deletionRow = await accountDeletionService.requestDeletion(userId);
    return res.status(202).json({
      requestId: deletionRow.id,
      blockchainDataNotice: BLOCKCHAIN_DATA_NOTICE,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/account/deletion-status/:requestId
 * Returns the current status of a deletion request.
 */
export async function getDeletionStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const { requestId } = req.params;
    const row = await accountDeletionService.getDeletionRequestById(requestId);
    if (!row) {
      return res.status(404).json({ error: 'Deletion request not found' });
    }
    const status = row.deletion_completed_at
      ? 'completed'
      : row.deletion_requested_at
      ? row.deletion_scheduled_for && new Date(row.deletion_scheduled_for) <= new Date()
        ? 'anonymized'
        : 'pending'
      : 'unknown';
    const phase = row.deletion_completed_at ? 2 : row.deletion_requested_at ? 1 : 0;
    return res.json({
      requestId: row.id,
      userId: row.id,
      status,
      phase,
      requestedAt: row.deletion_requested_at,
      estimatedCompletion: row.deletion_scheduled_for,
      blockchainDataNotice: BLOCKCHAIN_DATA_NOTICE,
    });
  } catch (err) {
    next(err);
  }
}
