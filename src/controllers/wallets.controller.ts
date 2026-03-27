// @ts-nocheck
import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { WalletsService } from '../services/wallets.service';
import { stellarService } from '../services/stellar.service';
import { ResponseUtil } from '../utils/response.utils';
import { logger } from '../utils/logger.utils';
import type { 
  PayoutRequestInput, 
  TrustlineRequestInput,
  TransactionQuery,
  EarningsQuery,
  BalanceQuery 
} from '../validators/schemas/wallet.schemas';

export const WalletsController = {
  /** GET /wallets/me */
  async getWalletInfo(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;
      
      const walletInfo = await WalletsService.getWalletInfo(userId);
      
      if (!walletInfo) {
        ResponseUtil.notFound(res, 'Wallet not found. Please create a wallet first.');
        return;
      }

      // Log wallet access event
      await WalletsService.logWalletEvent(userId, {
        eventType: 'balance_check',
        metadata: { action: 'wallet_info_access' },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      ResponseUtil.success(res, walletInfo, 'Wallet information retrieved successfully');
    } catch (error) {
      logger.error('wallets.getWalletInfo failed', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error,
      });
      ResponseUtil.error(res, 'Failed to retrieve wallet information', 500);
    }
  },

  /** GET /wallets/me/balance */
  async getBalance(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;
      const { assetCode, assetIssuer } = req.query as BalanceQuery;
      
      const wallet = await WalletsService.getUserWallet(userId);
      
      if (!wallet) {
        ResponseUtil.notFound(res, 'Wallet not found. Please create a wallet first.');
        return;
      }

      // Check if account exists on Stellar network
      const accountExists = await stellarService.accountExists(wallet.stellar_public_key);
      
      if (!accountExists) {
        ResponseUtil.success(res, {
          balances: [],
          accountExists: false,
          message: 'Account not yet created on Stellar network',
          lastUpdated: new Date().toISOString(),
        }, 'Account not found on Stellar network');
        return;
      }

      let balances;
      
      if (assetCode && assetCode !== 'XLM') {
        // Get specific asset balance
        const balance = await stellarService.getAssetBalance(
          wallet.stellar_public_key,
          assetCode,
          assetIssuer
        );
        balances = balance ? [balance] : [];
      } else {
        // Get all balances
        const accountInfo = await stellarService.getAccount(wallet.stellar_public_key);
        balances = accountInfo.balances;
      }

      // Log balance check event
      await WalletsService.logWalletEvent(userId, {
        eventType: 'balance_check',
        metadata: { 
          assetCode: assetCode || 'all',
          assetIssuer,
          balanceCount: balances.length,
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      ResponseUtil.success(res, {
        balances,
        accountExists: true,
        lastUpdated: new Date().toISOString(),
      }, 'Balance retrieved successfully');
    } catch (error) {
      logger.error('wallets.getBalance failed', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error,
      });
      
      // Handle specific Stellar errors
      if (error instanceof Error && error.message.includes('404')) {
        ResponseUtil.success(res, {
          balances: [],
          accountExists: false,
          message: 'Account not found on Stellar network',
          lastUpdated: new Date().toISOString(),
        }, 'Account not found on Stellar network');
        return;
      }
      
      ResponseUtil.error(res, 'Failed to retrieve balance information', 502);
    }
  },

  /** GET /wallets/me/transactions */
  async getTransactions(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;
      const { cursor, limit = 10, order = 'desc' } = req.query as TransactionQuery;
      
      const wallet = await WalletsService.getUserWallet(userId);
      
      if (!wallet) {
        ResponseUtil.notFound(res, 'Wallet not found. Please create a wallet first.');
        return;
      }

      // Check if account exists on Stellar network
      const accountExists = await stellarService.accountExists(wallet.stellar_public_key);
      
      if (!accountExists) {
        ResponseUtil.success(res, {
          transactions: [],
          pagination: { hasMore: false },
          message: 'Account not yet created on Stellar network',
        }, 'No transactions found');
        return;
      }

      const result = await stellarService.getTransactionHistory(
        wallet.stellar_public_key,
        cursor,
        limit,
        order
      );

      // Log transaction view event
      await WalletsService.logWalletEvent(userId, {
        eventType: 'transaction_view',
        metadata: { 
          cursor,
          limit,
          order,
          transactionCount: result.transactions.length,
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      ResponseUtil.success(res, {
        transactions: result.transactions,
        pagination: {
          cursor: result.nextCursor,
          hasMore: result.hasMore,
        },
      }, 'Transaction history retrieved successfully');
    } catch (error) {
      logger.error('wallets.getTransactions failed', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error,
      });
      ResponseUtil.error(res, 'Failed to retrieve transaction history', 502);
    }
  },

  /** POST /wallets/payout */
  async requestPayout(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;
      const payoutData = req.body as PayoutRequestInput;
      
      const payoutRequest = await WalletsService.createPayoutRequest(userId, payoutData);
      
      ResponseUtil.created(res, {
        id: payoutRequest.id,
        amount: payoutRequest.amount,
        assetCode: payoutRequest.asset_code,
        assetIssuer: payoutRequest.asset_issuer,
        destinationAddress: payoutRequest.destination_address,
        status: payoutRequest.status,
        requestedAt: payoutRequest.requested_at.toISOString(),
        memo: payoutRequest.memo,
      }, 'Payout request created successfully');
    } catch (error) {
      logger.error('wallets.requestPayout failed', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error,
      });
      
      // Handle specific business logic errors
      if (error instanceof Error) {
        if (error.message.includes('Invalid destination') || 
            error.message.includes('Invalid asset issuer')) {
          ResponseUtil.error(res, error.message, 400);
          return;
        }
        if (error.message.includes('Insufficient balance')) {
          ResponseUtil.error(res, error.message, 409);
          return;
        }
        if (error.message.includes('already associated')) {
          ResponseUtil.error(res, error.message, 409);
          return;
        }
      }
      
      ResponseUtil.error(res, 'Failed to create payout request', 500);
    }
  },

  /** POST /wallets/trustline */
  async addTrustline(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;
      const { assetCode, assetIssuer, limit } = req.body as TrustlineRequestInput;
      
      const wallet = await WalletsService.getUserWallet(userId);
      
      if (!wallet) {
        ResponseUtil.notFound(res, 'Wallet not found. Please create a wallet first.');
        return;
      }

      // Check if trustline already exists
      const hasTrustline = await WalletsService.hasTrustline(userId, assetCode, assetIssuer);
      
      if (hasTrustline) {
        ResponseUtil.conflict(res, 'Trustline already exists for this asset');
        return;
      }

      // Create trustline operation (this doesn't submit it, just creates the operation)
      const _trustlineOperation = stellarService.createTrustlineOperation(
        assetCode,
        assetIssuer,
        limit
      );

      // Log trustline add event
      await WalletsService.logWalletEvent(userId, {
        eventType: 'trustline_add',
        metadata: { 
          assetCode,
          assetIssuer,
          limit,
          operationType: 'change_trust',
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      // In a real implementation, you would:
      // 1. Create a transaction with this operation
      // 2. Return it to the client for signing
      // 3. Or handle the signing server-side if you have the private key
      
      ResponseUtil.success(res, {
        message: 'Trustline operation created successfully',
        operation: {
          type: 'change_trust',
          assetCode,
          assetIssuer,
          limit: limit || 'max',
        },
        // In production, you might return transaction XDR for client signing
        // transactionXdr: 'base64-encoded-transaction-xdr'
      }, 'Trustline operation prepared successfully');
    } catch (error) {
      logger.error('wallets.addTrustline failed', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error,
      });
      
      // Handle specific errors
      if (error instanceof Error) {
        if (error.message.includes('Invalid asset issuer')) {
          ResponseUtil.error(res, error.message, 400);
          return;
        }
        if (error.message.includes('Cannot create trustline for native XLM')) {
          ResponseUtil.error(res, error.message, 400);
          return;
        }
      }
      
      ResponseUtil.error(res, 'Failed to create trustline operation', 500);
    }
  },

  /** GET /wallets/me/earnings */
  async getEarnings(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;
      const { startDate, endDate, assetCode = 'USD' } = req.query as EarningsQuery;
      
      const earningsSummary = await WalletsService.getEarningsSummary(
        userId,
        startDate,
        endDate,
        assetCode
      );

      ResponseUtil.success(res, earningsSummary, 'Earnings summary retrieved successfully');
    } catch (error) {
      logger.error('wallets.getEarnings failed', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error,
      });
      ResponseUtil.error(res, 'Failed to retrieve earnings summary', 500);
    }
  },

  /** GET /wallets/me/payouts */
  async getPayoutRequests(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const offset = (page - 1) * limit;
      
      const payoutRequests = await WalletsService.getUserPayoutRequests(userId, limit, offset);
      
      const formattedRequests = payoutRequests.map(request => ({
        id: request.id,
        amount: request.amount,
        assetCode: request.asset_code,
        assetIssuer: request.asset_issuer,
        destinationAddress: request.destination_address,
        status: request.status,
        memo: request.memo,
        requestedAt: request.requested_at.toISOString(),
        processedAt: request.processed_at?.toISOString(),
        transactionHash: request.transaction_hash,
        notes: request.notes,
      }));

      ResponseUtil.success(res, {
        payoutRequests: formattedRequests,
        pagination: {
          page,
          limit,
          hasMore: payoutRequests.length === limit,
        },
      }, 'Payout requests retrieved successfully');
    } catch (error) {
      logger.error('wallets.getPayoutRequests failed', {
        userId: req.user?.id,
        error: error instanceof Error ? error.message : error,
      });
      ResponseUtil.error(res, 'Failed to retrieve payout requests', 500);
    }
  },
};