import { WalletsService } from '../../services/wallets.service';
import { WalletModel } from '../../models/wallet.model';
import { PayoutRequestModel } from '../../models/payout-request.model';
import { WalletEventModel } from '../../models/wallet-event.model';
import { PaymentModel } from '../../models/payment.model';
import { stellarService } from '../../services/stellar.service';
import { createUser, createWallet, createPayoutRequest, generateUniqueStellarPublicKey } from '../../tests/factories';

// Mock the stellar service
jest.mock('../../services/stellar.service');
const mockedStellarService = stellarService as jest.Mocked<typeof stellarService>;

// Mock the payment model
jest.mock('../../models/payment.model');
const mockedPaymentModel = PaymentModel as jest.Mocked<typeof PaymentModel>;

describe('WalletsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getUserWallet', () => {
    it('should return existing wallet for user', async () => {
      const { user, wallet } = await createWallet();

      const result = await WalletsService.getUserWallet(user.id);

      expect(result).toBeDefined();
      expect(result!.id).toBe(wallet.id);
      expect(result!.user_id).toBe(user.id);
      expect(result!.stellar_public_key).toBe(wallet.stellar_public_key);
    });

    it('should return null for non-existent user without stellar key', async () => {
      const nonExistentUserId = '123e4567-e89b-12d3-a456-426614174000';

      const result = await WalletsService.getUserWallet(nonExistentUserId);

      expect(result).toBeNull();
    });

    it('should create new wallet when stellar key provided', async () => {
      const user = await createUser();
      const stellarPublicKey = generateUniqueStellarPublicKey();
      
      mockedStellarService.validatePublicKey.mockReturnValue(true);

      const result = await WalletsService.getUserWallet(user.id, stellarPublicKey);

      expect(result).toBeDefined();
      expect(result!.user_id).toBe(user.id);
      expect(result!.stellar_public_key).toBe(stellarPublicKey);
      expect(result!.status).toBe('active');
      expect(mockedStellarService.validatePublicKey).toHaveBeenCalledWith(stellarPublicKey);
    });

    it('should throw error for invalid stellar key', async () => {
      const user = await createUser();
      const invalidKey = 'INVALID_KEY';
      
      mockedStellarService.validatePublicKey.mockReturnValue(false);

      await expect(WalletsService.getUserWallet(user.id, invalidKey))
        .rejects.toThrow('Invalid Stellar public key format');
    });

    it('should throw error for duplicate stellar key', async () => {
      const { wallet } = await createWallet();
      const user2 = await createUser();
      
      mockedStellarService.validatePublicKey.mockReturnValue(true);

      await expect(WalletsService.getUserWallet(user2.id, wallet.stellar_public_key))
        .rejects.toThrow('Stellar address already associated with another wallet');
    });
  });

  describe('getWalletInfo', () => {
    it('should return formatted wallet info', async () => {
      const { user, wallet } = await createWallet();

      const result = await WalletsService.getWalletInfo(user.id);

      expect(result).toBeDefined();
      expect(result!.id).toBe(wallet.id);
      expect(result!.stellarPublicKey).toBe(wallet.stellar_public_key);
      expect(result!.status).toBe(wallet.status);
      expect(result!.createdAt).toBeDefined();
    });

    it('should return null for non-existent wallet', async () => {
      const user = await createUser();

      const result = await WalletsService.getWalletInfo(user.id);

      expect(result).toBeNull();
    });

    it('should include last activity when available', async () => {
      const { user } = await createWallet();
      
      // Create a wallet event
      await WalletEventModel.create({
        userId: user.id,
        eventType: 'balance_check',
        metadata: { test: true },
      });

      const result = await WalletsService.getWalletInfo(user.id);

      expect(result!.lastActivity).toBeDefined();
    });
  });

  describe('createPayoutRequest', () => {
    it('should create valid payout request', async () => {
      const { user } = await createWallet();
      const payoutData = {
        amount: '100.0000000',
        assetCode: 'XLM',
        destinationAddress: generateUniqueStellarPublicKey('DEST'),
        memo: 'Test payout',
      };

      mockedStellarService.validatePublicKey.mockReturnValue(true);

      const result = await WalletsService.createPayoutRequest(user.id, payoutData);

      expect(result).toBeDefined();
      expect(result.user_id).toBe(user.id);
      expect(result.amount).toBe(payoutData.amount);
      expect(result.asset_code).toBe(payoutData.assetCode);
      expect(result.destination_address).toBe(payoutData.destinationAddress);
      expect(result.memo).toBe(payoutData.memo);
      expect(result.status).toBe('pending');
    });

    it('should throw error for invalid destination address', async () => {
      const { user } = await createWallet();
      const payoutData = {
        amount: '100.0000000',
        assetCode: 'XLM',
        destinationAddress: 'INVALID_ADDRESS',
      };

      mockedStellarService.validatePublicKey.mockReturnValue(false);

      await expect(WalletsService.createPayoutRequest(user.id, payoutData))
        .rejects.toThrow('Invalid destination Stellar address');
    });

    it('should throw error for invalid asset issuer', async () => {
      const { user } = await createWallet();
      const payoutData = {
        amount: '100.0000000',
        assetCode: 'USD',
        assetIssuer: 'INVALID_ISSUER',
        destinationAddress: generateUniqueStellarPublicKey('DEST'),
      };

      mockedStellarService.validatePublicKey
        .mockReturnValueOnce(true)  // destination address
        .mockReturnValueOnce(false); // asset issuer

      await expect(WalletsService.createPayoutRequest(user.id, payoutData))
        .rejects.toThrow('Invalid asset issuer address');
    });

    it('should check balance when wallet exists', async () => {
      const { user, wallet } = await createWallet();
      const payoutData = {
        amount: '100.0000000',
        assetCode: 'XLM',
        destinationAddress: generateUniqueStellarPublicKey('DEST'),
      };

      mockedStellarService.validatePublicKey.mockReturnValue(true);
      mockedStellarService.getAssetBalance.mockResolvedValue({
        assetType: 'native',
        balance: '50.0000000',
        limit: undefined,
      });

      await expect(WalletsService.createPayoutRequest(user.id, payoutData))
        .rejects.toThrow('Insufficient balance for payout request');

      expect(mockedStellarService.getAssetBalance).toHaveBeenCalledWith(
        wallet.stellar_public_key,
        payoutData.assetCode,
        undefined
      );
    });

    it('should create payout request with sufficient balance', async () => {
      const { user, wallet } = await createWallet();
      const payoutData = {
        amount: '50.0000000',
        assetCode: 'XLM',
        destinationAddress: generateUniqueStellarPublicKey('DEST'),
      };

      mockedStellarService.validatePublicKey.mockReturnValue(true);
      mockedStellarService.getAssetBalance.mockResolvedValue({
        assetType: 'native',
        balance: '100.0000000',
        limit: undefined,
      });

      const result = await WalletsService.createPayoutRequest(user.id, payoutData);

      expect(result).toBeDefined();
      expect(result.amount).toBe(payoutData.amount);
    });

    it('should handle balance check failures gracefully', async () => {
      const { user } = await createWallet();
      const payoutData = {
        amount: '100.0000000',
        assetCode: 'XLM',
        destinationAddress: generateUniqueStellarPublicKey('DEST'),
      };

      mockedStellarService.validatePublicKey.mockReturnValue(true);
      mockedStellarService.getAssetBalance.mockRejectedValue(new Error('Network error'));

      // Should still create the payout request despite balance check failure
      const result = await WalletsService.createPayoutRequest(user.id, payoutData);

      expect(result).toBeDefined();
      expect(result.amount).toBe(payoutData.amount);
    });
  });

  describe('getEarningsSummary', () => {
    it('should return earnings summary', async () => {
      const { user } = await createWallet();
      const mockEarnings = [
        {
          id: '1',
          amount: 50.0,
          currency: 'USD',
          created_at: new Date(),
        },
        {
          id: '2',
          amount: 75.0,
          currency: 'USD',
          created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
        },
      ];

      mockedPaymentModel.findEarningsByMentorId.mockResolvedValue(mockEarnings as any);

      const result = await WalletsService.getEarningsSummary(user.id);

      expect(result).toBeDefined();
      expect(result.totalEarnings).toBe('125.00');
      expect(result.recentTransactions).toHaveLength(2);
      expect(result.periodSummary.sessionCount).toBe(1); // Only one in last 30 days
      expect(mockedPaymentModel.findEarningsByMentorId).toHaveBeenCalledWith(
        user.id,
        undefined,
        undefined
      );
    });

    it('should handle date range filters', async () => {
      const { user } = await createWallet();
      const startDate = '2024-01-01T00:00:00.000Z';
      const endDate = '2024-01-31T23:59:59.999Z';

      mockedPaymentModel.findEarningsByMentorId.mockResolvedValue([]);

      await WalletsService.getEarningsSummary(user.id, startDate, endDate, 'USD');

      expect(mockedPaymentModel.findEarningsByMentorId).toHaveBeenCalledWith(
        user.id,
        startDate,
        endDate
      );
    });

    it('should handle empty earnings', async () => {
      const { user } = await createWallet();

      mockedPaymentModel.findEarningsByMentorId.mockResolvedValue([]);

      const result = await WalletsService.getEarningsSummary(user.id);

      expect(result.totalEarnings).toBe('0.00');
      expect(result.currentPeriodEarnings).toBe('0.00');
      expect(result.recentTransactions).toHaveLength(0);
      expect(result.periodSummary.sessionCount).toBe(0);
      expect(result.periodSummary.averageEarning).toBe('0.00');
    });
  });

  describe('logWalletEvent', () => {
    it('should create wallet event', async () => {
      const { user } = await createWallet();
      const eventData = {
        eventType: 'balance_check' as const,
        metadata: { action: 'test' },
        ipAddress: '127.0.0.1',
        userAgent: 'Test Agent',
      };

      const result = await WalletsService.logWalletEvent(user.id, eventData);

      expect(result).toBeDefined();
      expect(result!.user_id).toBe(user.id);
      expect(result!.event_type).toBe(eventData.eventType);
      expect(result!.metadata).toEqual(eventData.metadata);
    });

    it('should handle event creation failure gracefully', async () => {
      const { user } = await createWallet();
      const eventData = {
        eventType: 'balance_check' as const,
      };

      // Mock a database error by using invalid user ID
      const result = await WalletsService.logWalletEvent('invalid-user-id', eventData);

      expect(result).toBeNull();
    });
  });

  describe('getUserPayoutRequests', () => {
    it('should return user payout requests', async () => {
      const { user } = await createWallet();
      await createPayoutRequest({ userId: user.id });
      await createPayoutRequest({ userId: user.id });

      const result = await WalletsService.getUserPayoutRequests(user.id);

      expect(result).toHaveLength(2);
      expect(result[0].user_id).toBe(user.id);
      expect(result[1].user_id).toBe(user.id);
    });

    it('should respect pagination parameters', async () => {
      const { user } = await createWallet();
      await createPayoutRequest({ userId: user.id });
      await createPayoutRequest({ userId: user.id });
      await createPayoutRequest({ userId: user.id });

      const result = await WalletsService.getUserPayoutRequests(user.id, 2, 1);

      expect(result).toHaveLength(2);
    });
  });

  describe('updateWalletStatus', () => {
    it('should update wallet status', async () => {
      const { user, wallet } = await createWallet();

      const result = await WalletsService.updateWalletStatus(user.id, 'suspended');

      expect(result).toBeDefined();
      expect(result!.status).toBe('suspended');
      expect(result!.id).toBe(wallet.id);
    });

    it('should return null for non-existent wallet', async () => {
      const user = await createUser();

      const result = await WalletsService.updateWalletStatus(user.id, 'inactive');

      expect(result).toBeNull();
    });
  });

  describe('hasTrustline', () => {
    it('should return true when trustline exists', async () => {
      const { user, wallet } = await createWallet();
      const assetCode = 'USD';
      const assetIssuer = generateUniqueStellarPublicKey('ISSUER');

      mockedStellarService.getAssetBalance.mockResolvedValue({
        assetType: 'credit_alphanum4',
        assetCode,
        assetIssuer,
        balance: '0.0000000',
        limit: '1000.0000000',
      });

      const result = await WalletsService.hasTrustline(user.id, assetCode, assetIssuer);

      expect(result).toBe(true);
      expect(mockedStellarService.getAssetBalance).toHaveBeenCalledWith(
        wallet.stellar_public_key,
        assetCode,
        assetIssuer
      );
    });

    it('should return false when trustline does not exist', async () => {
      const { user, wallet } = await createWallet();
      const assetCode = 'USD';
      const assetIssuer = generateUniqueStellarPublicKey('ISSUER');

      mockedStellarService.getAssetBalance.mockResolvedValue(null);

      const result = await WalletsService.hasTrustline(user.id, assetCode, assetIssuer);

      expect(result).toBe(false);
    });

    it('should return false for non-existent wallet', async () => {
      const user = await createUser();
      const assetCode = 'USD';
      const assetIssuer = generateUniqueStellarPublicKey('ISSUER');

      const result = await WalletsService.hasTrustline(user.id, assetCode, assetIssuer);

      expect(result).toBe(false);
    });

    it('should handle stellar service errors', async () => {
      const { user } = await createWallet();
      const assetCode = 'USD';
      const assetIssuer = generateUniqueStellarPublicKey('ISSUER');

      mockedStellarService.getAssetBalance.mockRejectedValue(new Error('Network error'));

      const result = await WalletsService.hasTrustline(user.id, assetCode, assetIssuer);

      expect(result).toBe(false);
    });
  });

  describe('getWalletStats', () => {
    it('should return wallet statistics', async () => {
      // Create some test data
      await createWallet();
      await createWallet();
      await createPayoutRequest({ status: 'pending' });
      await createPayoutRequest({ status: 'completed' });

      const result = await WalletsService.getWalletStats();

      expect(result).toBeDefined();
      expect(result.totalWallets).toBeGreaterThanOrEqual(2);
      expect(result.activeWallets).toBeGreaterThanOrEqual(2);
      expect(result.totalPayoutRequests).toBeGreaterThanOrEqual(2);
      expect(result.pendingPayouts).toBeGreaterThanOrEqual(1);
    });
  });
});