import { stellarService } from './stellar.service';
import { WsService } from './ws.service';
import { WalletModel } from '../models/wallet.model';
import { getPlatformKeypair } from '../config/stellar';
import { logger } from '../utils/logger.utils';
import type { StellarPaymentRecord } from '../types/stellar.types';

let closeStream: (() => void) | null = null;

/**
 * Start streaming transactions for the platform's Stellar account.
 *
 * Uses `stellarService.streamPayments()` which internally calls
 * `server.payments().forAccount(key).stream()` on the Horizon SSE endpoint.
 *
 * For each incoming payment whose destination matches a platform-linked wallet,
 * the service resolves the owner and pushes a real-time `payment:confirmed`
 * event through the WebSocket layer.
 */
export function startStellarStream(): void {
  const keypair = getPlatformKeypair();
  if (!keypair) {
    logger.warn('StellarStream: no platform key configured — stream disabled');
    return;
  }

  const platformKey = keypair.publicKey();
  logger.info('StellarStream: subscribing to Horizon SSE', { account: platformKey });

  closeStream = stellarService.streamPayments(
    platformKey,
    (payment: StellarPaymentRecord) => {
      handleIncomingPayment(payment, platformKey).catch((err) => {
        logger.error('StellarStream: failed to process payment', {
          txHash: payment.transactionHash,
          error: err instanceof Error ? err.message : err,
        });
      });
    },
    'now',
  );
}

/**
 * Process a single incoming payment from the Horizon stream.
 *
 * 1. Identify the sender by looking up their Stellar key in the wallets table.
 * 2. Push a `payment:confirmed` WS event to the sender (payer).
 * 3. If the payment is *to* the platform account, also notify any user
 *    whose wallet matches the `from` address (this covers escrow deposits
 *    and direct payments to the platform).
 */
async function handleIncomingPayment(
  payment: StellarPaymentRecord,
  platformKey: string,
): Promise<void> {
  logger.info('StellarStream: payment received', {
    txHash: payment.transactionHash,
    from: payment.from,
    to: payment.to,
    amount: payment.amount,
    asset: payment.assetCode ?? 'XLM',
  });

  // Resolve the sender to a platform user
  const senderWallet = await WalletModel.findByStellarPublicKey(payment.from);
  if (senderWallet) {
    await WsService.publish(senderWallet.user_id, 'payment:confirmed', {
      transactionHash: payment.transactionHash,
      from: payment.from,
      to: payment.to,
      amount: payment.amount,
      asset: payment.assetCode ?? 'XLM',
      direction: 'outgoing',
      ts: Date.now(),
    });
  }

  // Resolve the receiver to a platform user (could be a mentor payout)
  const receiverWallet = await WalletModel.findByStellarPublicKey(payment.to);
  if (receiverWallet && receiverWallet.user_id !== senderWallet?.user_id) {
    await WsService.publish(receiverWallet.user_id, 'payment:confirmed', {
      transactionHash: payment.transactionHash,
      from: payment.from,
      to: payment.to,
      amount: payment.amount,
      asset: payment.assetCode ?? 'XLM',
      direction: 'incoming',
      ts: Date.now(),
    });
  }
}

/**
 * Stop the Horizon SSE stream. Called during graceful shutdown.
 */
export function stopStellarStream(): void {
  if (closeStream) {
    closeStream();
    closeStream = null;
    logger.info('StellarStream: stream closed');
  }
}
