import { WalletModel, type Wallet } from '../models/wallet.model';
import { PayoutRequestModel, type PayoutRequest } from '../models/payout-request.model';
import { WalletEventModel, type WalletEvent } from '../models/wallet-event.model';
import { PaymentModel } from '../models/payment.model';
import { stellarService } from './stellar.service';
import { logger } from '../utils/logger.utils';

export interface WalletInfo {
  id: string;
  stellarPublicKey: string;
  status: string;
  createdAt: string;
  lastActivity?: string;
}

export interface EarningsSummary {
  totalEarnings: string;
  currentPeriodEarnings: string;
  recentTransactions: Array<{
    id: string;
    amount: string;
    assetCode: string;
    date: string;
    type: 'session_payment' | 'bonus' | 'referral';
  }>;
  periodSummary: {
    startDate: string;
    endDate: string;
    sessionCount: number;
    averageEarning: string;
  };
}

export interface PayoutRequestData {
  amount: string;
  assetCode: string;
  assetIssuer?: string;
  destinationAddress: string;
  memo?: string;
}

export interface WalletEventData {
  eventType: WalletEvent['event_type'];
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

export const WalletsService = {
  /**
   * Get or create a user's wallet record
   * @param userId - User ID
   * @param stellarPublicKey - Stellar public key (required for creation)
   * @returns Wallet record or null if not found and no public key provided
   */
  async getUserWallet(userId: string, stellarPublicKey?: string): Promise<Wallet | null> {
    try {
      // Try to find existing wallet
      let wallet = await WalletModel.findByUserId(userId);
      
      if (!wallet && stellarPublicKey) {
        // Validate the Stellar public key before creating wallet
        if (!stellarService.validatePublicKey(stellarPublicKey)) {
          throw new Error('Invalid Stellar public key format');
        }

        // Check if this Stellar address is already associated with another user
        const existingWallet = await WalletModel.findByStellarPublicKey(stellarPublicKey);
        if (existingWallet) {
          throw new Error('Stellar address already associated with another wallet');
        }

        // Create new wallet
        wallet = await WalletModel.create(userId, stellarPublicKey);
        
        // Log wallet creation event
        await this.logWalletEvent(userId, {
          eventType: 'wallet_created',
          metadata: { stellarPublicKey },
        });

        logger.info('wallet.created', { userId, stellarPublicKey });
      }

      return wallet;
    } catch (error) {
      logger.error('wallet.getUserWallet failed', {
        userId,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  },

  /**
   * Get wallet information formatted for API response
   * @param userId - User ID
   * @returns Formatted wallet info or null if not found
   */
  async getWalletInfo(userId: string): Promise<WalletInfo | null> {
    const wallet = await this.getUserWallet(userId);
    if (!wallet) return null;

    // Get last activity from wallet events
    const recentEvents = await WalletEventModel.findByUserId(userId, 1);
    const lastActivity = recentEvents[0]?.created_at;

    return {
      id: wallet.id,
      stellarPublicKey: wallet.stellar_public_key,
      status: wallet.status,
      createdAt: wallet.created_at.toISOString(),
      lastActivity: lastActivity?.toISOString(),
    };
  },

  /**
   * Create a payout request
   * @param userId - User ID
   * @param payoutData - Payout request data
   * @returns Created payout request
   */
  async createPayoutRequest(userId: string, payoutData: PayoutRequestData): Promise<PayoutRequest> {
    try {
      // Validate destination address
      if (!stellarService.validatePublicKey(payoutData.destinationAddress)) {
        throw new Error('Invalid destination Stellar address');
      }

      // Validate asset issuer if provided
      if (payoutData.assetIssuer && !stellarService.validatePublicKey(payoutData.assetIssuer)) {
        throw new Error('Invalid asset issuer address');
      }

      // Check if user has sufficient balance (if we can access their wallet)
      const wallet = await this.getUserWallet(userId);
      if (wallet) {
        try {
          const balance = await stellarService.getAssetBalance(
            wallet.stellar_public_key,
            payoutData.assetCode,
            payoutData.assetIssuer
          );

          if (balance && parseFloat(balance.balance) < parseFloat(payoutData.amount)) {
            throw new Error('Insufficient balance for payout request');
          }
        } catch (balanceError) {
          // Log but don't fail - balance check is informational
          logger.warn('wallet.createPayoutRequest balance check failed', {
            userId,
            error: balanceError instanceof Error ? balanceError.message : balanceError,
          });
        }
      }

      // Check for pending payout requests to prevent double-spending
      const pendingAmount = await PayoutRequestModel.getTotalRequestedAmount(
        userId,
        payoutData.assetCode
      );
      
      const totalRequested = parseFloat(pendingAmount) + parseFloat(payoutData.amount);
      
      // This is a soft check - admin can still approve if needed
      if (wallet) {
        try {
          const balance = await stellarService.getAssetBalance(
            wallet.stellar_public_key,
            payoutData.assetCode,
            payoutData.assetIssuer
          );
          
          if (balance && totalRequested > parseFloat(balance.balance)) {
            logger.warn('wallet.createPayoutRequest total requested exceeds balance', {
              userId,
              totalRequested,
              balance: balance.balance,
            });
          }
        } catch {
          // Ignore balance check errors
        }
      }

      // Create payout request
      const payoutRequest = await PayoutRequestModel.create({
        userId,
        amount: payoutData.amount,
        assetCode: payoutData.assetCode,
        assetIssuer: payoutData.assetIssuer,
        destinationAddress: payoutData.destinationAddress,
        memo: payoutData.memo,
      });

      // Log payout request event
      await this.logWalletEvent(userId, {
        eventType: 'payout_request',
        metadata: {
          payoutRequestId: payoutRequest.id,
          amount: payoutData.amount,
          assetCode: payoutData.assetCode,
          destinationAddress: payoutData.destinationAddress,
        },
      });

      logger.info('wallet.payoutRequest created', {
        userId,
        payoutRequestId: payoutRequest.id,
        amount: payoutData.amount,
        assetCode: payoutData.assetCode,
      });

      return payoutRequest;
    } catch (error) {
      logger.error('wallet.createPayoutRequest failed', {
        userId,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  },

  /**
   * Get earnings summary for a user
   * @param userId - User ID
   * @param startDate - Start date for period (optional)
   * @param endDate - End date for period (optional)
   * @param assetCode - Asset code filter (optional)
   * @returns Earnings summary
   */
  async getEarningsSummary(
    userId: string,
    startDate?: string,
    endDate?: string,
    assetCode: string = 'USD'
  ): Promise<EarningsSummary> {
    try {
      // Get earnings from payments (assuming user is a mentor)
      const earnings = await PaymentModel.findEarningsByMentorId(userId, startDate, endDate);
      
      // Calculate total earnings
      const totalEarnings = earnings.reduce((sum, payment) => {
        return sum + parseFloat(payment.amount.toString());
      }, 0);

      // Calculate current period earnings (last 30 days if no dates provided)
      const periodStart = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const periodEnd = endDate || new Date().toISOString();
      
      const periodEarnings = earnings.filter(payment => {
        const paymentDate = new Date(payment.created_at);
        return paymentDate >= new Date(periodStart) && paymentDate <= new Date(periodEnd);
      });

      const currentPeriodEarnings = periodEarnings.reduce((sum, payment) => {
        return sum + parseFloat(payment.amount.toString());
      }, 0);

      // Get recent transactions (last 10)
      const recentTransactions = earnings.slice(0, 10).map(payment => ({
        id: payment.id,
        amount: payment.amount.toString(),
        assetCode: payment.currency || assetCode,
        date: payment.created_at.toISOString(),
        type: 'session_payment' as const,
      }));

      // Calculate period summary
      const sessionCount = periodEarnings.length;
      const averageEarning = sessionCount > 0 ? (currentPeriodEarnings / sessionCount).toFixed(2) : '0.00';

      // Log earnings view event
      await this.logWalletEvent(userId, {
        eventType: 'earnings_view',
        metadata: {
          startDate: periodStart,
          endDate: periodEnd,
          assetCode,
          totalEarnings: totalEarnings.toFixed(2),
        },
      });

      return {
        totalEarnings: totalEarnings.toFixed(2),
        currentPeriodEarnings: currentPeriodEarnings.toFixed(2),
        recentTransactions,
        periodSummary: {
          startDate: periodStart,
          endDate: periodEnd,
          sessionCount,
          averageEarning,
        },
      };
    } catch (error) {
      logger.error('wallet.getEarningsSummary failed', {
        userId,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  },

  /**
   * Log a wallet event for audit purposes
   * @param userId - User ID
   * @param eventData - Event data
   * @returns Created event record or null if failed
   */
  async logWalletEvent(userId: string, eventData: WalletEventData): Promise<WalletEvent | null> {
    try {
      return await WalletEventModel.create({
        userId,
        ...eventData,
      });
    } catch (error) {
      logger.error('wallet.logWalletEvent failed', {
        userId,
        eventType: eventData.eventType,
        error: error instanceof Error ? error.message : error,
      });
      return null;
    }
  },

  /**
   * Get user's payout requests
   * @param userId - User ID
   * @param limit - Number of requests to fetch
   * @param offset - Offset for pagination
   * @returns Array of payout requests
   */
  async getUserPayoutRequests(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<PayoutRequest[]> {
    return await PayoutRequestModel.findByUserId(userId, limit, offset);
  },

  /**
   * Update wallet status
   * @param userId - User ID
   * @param status - New status
   * @returns Updated wallet or null if not found
   */
  async updateWalletStatus(userId: string, status: Wallet['status']): Promise<Wallet | null> {
    try {
      const wallet = await WalletModel.updateStatus(userId, status);
      
      if (wallet) {
        await this.logWalletEvent(userId, {
          eventType: 'wallet_created', // Reusing event type for status changes
          metadata: { statusChange: status, previousStatus: wallet.status },
        });

        logger.info('wallet.statusUpdated', { userId, status });
      }

      return wallet;
    } catch (error) {
      logger.error('wallet.updateWalletStatus failed', {
        userId,
        status,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  },

  /**
   * Check if user has a trustline for a specific asset
   * Uses cached balance lookup to reduce Horizon API calls
   * @param userId - User ID
   * @param assetCode - Asset code
   * @param assetIssuer - Asset issuer
   * @returns True if trustline exists, false otherwise
   */
  async hasTrustline(userId: string, assetCode: string, assetIssuer: string): Promise<boolean> {
    try {
      const wallet = await this.getUserWallet(userId);
      if (!wallet) return false;

      const balance = await stellarService.getAssetBalance(
        wallet.stellar_public_key,
        assetCode,
        assetIssuer
      );

      return balance !== null;
    } catch (error) {
      logger.error('wallet.hasTrustline failed', {
        userId,
        assetCode,
        assetIssuer,
        error: error instanceof Error ? error.message : error,
      });
      return false;
    }
  },

  /**
   * Get wallet statistics for admin/analytics
   * @returns Wallet statistics
   */
  async getWalletStats(): Promise<{
    totalWallets: number;
    activeWallets: number;
    totalPayoutRequests: number;
    pendingPayouts: number;
  }> {
    try {
      const [totalWallets, totalPayoutRequests, pendingPayouts] = await Promise.all([
        WalletModel.count(),
        PayoutRequestModel.count(),
        PayoutRequestModel.countByStatus('pending'),
      ]);

      // Count active wallets (those with recent activity)
      const activeWallets = totalWallets; // Simplified - could be enhanced with activity check

      return {
        totalWallets,
        activeWallets,
        totalPayoutRequests,
        pendingPayouts,
      };
    } catch (error) {
      logger.error('wallet.getWalletStats failed', {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  },
};