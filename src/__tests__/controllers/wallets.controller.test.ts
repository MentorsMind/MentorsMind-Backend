import { Request, Response } from 'express';
import { WalletsController } from '../../controllers/wallets.controller';
import { WalletsService } from '../../services/wallets.service';
import { stellarService } from '../../services/stellar.service';
import { ResponseUtil } from '../../utils/response.utils';
import { AuthenticatedRequest } from '../../types';
import { createUser, generateUniqueStellarPublicKey } from '../../tests/factories';

// Mock dependencies
jest.mock('../../services/wallets.service');
jest.mock('../../services/stellar.service');
jest.mock('../../utils/response.utils');

const mockedWalletsService = WalletsService as jest.Mocked<typeof WalletsService>;
const mockedStellarService = stellarService as jest.Mocked<typeof stellarService>;
const mockedResponseUtil = ResponseUtil as jest.Mocked<typeof ResponseUtil>;

describe('WalletsController', () => {
  let mockRequest: Partial<AuthenticatedRequest>;
  let mockResponse: Partial<Response>;
  let user: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    
    user = await createUser();
    
    mockRequest = {
      user: { id: user.id, email: user.email, role: user.role },
      ip: '127.0.0.1',
      get: jest.fn().mockReturnValue('Test User Agent'),
      query: {},
      body: {},
    };
    
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  describe('getWalletInfo', () => {
    it('should return wallet information successfully', async () => {
      const mockWalletInfo = {
        id: 'wallet-id',
        stellarPublicKey: generateUniqueStellarPublicKey(),
        status: 'active',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      };

      mockedWalletsService.getWalletInfo.mockResolvedValue(mockWalletInfo);
      mockedWalletsService.logWalletEvent.mockResolvedValue(null);

      await WalletsController.getWalletInfo(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response
      );

      expect(mockedWalletsService.getWalletInfo).toHaveBeenCalledWith(user.id);
      expect(mockedWalletsService.logWalletEvent).toHaveBeenCalledWith(user.id, {
        eventType: 'balance_check',
        metadata: { action: 'wallet_info_access' },
        ipAddress: '127.0.0.1',
        userAgent: 'Test User Agent',
      });
      expect(mockedResponseUtil.success).toHaveBeenCalledWith(
        mockResponse,
        mockWalletInfo,
        'Wallet information retrieved successfully'
      );
    });

    it('should return 404 when wallet not found', async () => {
      mockedWalletsService.getWalletInfo.mockResolvedValue(null);

      await WalletsController.getWalletInfo(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response
      );

      expect(mockedResponseUtil.notFound).toHaveBeenCalledWith(
        mockResponse,
        'Wallet not found. Please create a wallet first.'
      );
    });

    it('should handle service errors', async () => {
      mockedWalletsService.getWalletInfo.mockRejectedValue(new Error('Database error'));

      await WalletsController.getWalletInfo(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response
      );

      expect(mockedResponseUtil.error).toHaveBeenCalledWith(
        mockResponse,
        'Failed to retrieve wallet information',
        500
      );
    });
  });

  describe('getBalance', () => {
    it('should return balance information successfully', async () => {
      const mockWallet = {
        id: 'wallet-id',
        stellar_public_key: generateUniqueStellarPublicKey(),
        status: 'active',
      };
      const mockAccountInfo = {
        balances: [
          {
            assetType: 'native',
            balance: '1000.0000000',
            limit: undefined,
          },
        ],
      };

      mockedWalletsService.getUserWallet.mockResolvedValue(mockWallet as any);
      mockedStellarService.accountExists.mockResolvedValue(true);
      mockedStellarService.getAccount.mockResolvedValue(mockAccountInfo as any);
      mockedWalletsService.logWalletEvent.mockResolvedValue(null);

      await WalletsController.getBalance(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response
      );

      expect(mockedWalletsService.getUserWallet).toHaveBeenCalledWith(user.id);
      expect(mockedStellarService.accountExists).toHaveBeenCalledWith(mockWallet.stellar_public_key);
      expect(mockedStellarService.getAccount).toHaveBeenCalledWith(mockWallet.stellar_public_key);
      expect(mockedResponseUtil.success).toHaveBeenCalledWith(
        mockResponse,
        {
          balances: mockAccountInfo.balances,
          accountExists: true,
          lastUpdated: expect.any(String),
        },
        'Balance retrieved successfully'
      );
    });

    it('should handle specific asset balance request', async () => {
      const mockWallet = {
        id: 'wallet-id',
        stellar_public_key: generateUniqueStellarPublicKey(),
        status: 'active',
      };
      const mockBalance = {
        assetType: 'credit_alphanum4',
        assetCode: 'USD',
        assetIssuer: generateUniqueStellarPublicKey('ISSUER'),
        balance: '500.0000000',
        limit: '1000.0000000',
      };

      mockRequest.query = { assetCode: 'USD', assetIssuer: mockBalance.assetIssuer };

      mockedWalletsService.getUserWallet.mockResolvedValue(mockWallet as any);
      mockedStellarService.accountExists.mockResolvedValue(true);
      mockedStellarService.getAssetBalance.mockResolvedValue(mockBalance as any);
      mockedWalletsService.logWalletEvent.mockResolvedValue(null);

      await WalletsController.getBalance(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response
      );

      expect(mockedStellarService.getAssetBalance).toHaveBeenCalledWith(
        mockWallet.stellar_public_key,
        'USD',
        mockBalance.assetIssuer
      );
      expect(mockedResponseUtil.success).toHaveBeenCalledWith(
        mockResponse,
        {
          balances: [mockBalance],
          accountExists: true,
          lastUpdated: expect.any(String),
        },
        'Balance retrieved successfully'
      );
    });

    it('should handle account not found on Stellar network', async () => {
      const mockWallet = {
        id: 'wallet-id',
        stellar_public_key: generateUniqueStellarPublicKey(),
        status: 'active',
      };

      mockedWalletsService.getUserWallet.mockResolvedValue(mockWallet as any);
      mockedStellarService.accountExists.mockResolvedValue(false);

      await WalletsController.getBalance(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response
      );

      expect(mockedResponseUtil.success).toHaveBeenCalledWith(
        mockResponse,
        {
          balances: [],
          accountExists: false,
          message: 'Account not yet created on Stellar network',
          lastUpdated: expect.any(String),
        },
        'Account not found on Stellar network'
      );
    });

    it('should return 404 when wallet not found', async () => {
      mockedWalletsService.getUserWallet.mockResolvedValue(null);

      await WalletsController.getBalance(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response
      );

      expect(mockedResponseUtil.notFound).toHaveBeenCalledWith(
        mockResponse,
        'Wallet not found. Please create a wallet first.'
      );
    });

    it('should handle Stellar 404 errors', async () => {
      const mockWallet = {
        id: 'wallet-id',
        stellar_public_key: generateUniqueStellarPublicKey(),
        status: 'active',
      };

      mockedWalletsService.getUserWallet.mockResolvedValue(mockWallet as any);
      mockedStellarService.accountExists.mockResolvedValue(true);
      mockedStellarService.getAccount.mockRejectedValue(new Error('404'));

      await WalletsController.getBalance(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response
      );

      expect(mockedResponseUtil.success).toHaveBeenCalledWith(
        mockResponse,
        {
          balances: [],
          accountExists: false,
          message: 'Account not found on Stellar network',
          lastUpdated: expect.any(String),
        },
        'Account not found on Stellar network'
      );
    });

    it('should handle other Stellar errors', async () => {
      const mockWallet = {
        id: 'wallet-id',
        stellar_public_key: generateUniqueStellarPublicKey(),
        status: 'active',
      };

      mockedWalletsService.getUserWallet.mockResolvedValue(mockWallet as any);
      mockedStellarService.accountExists.mockResolvedValue(true);
      mockedStellarService.getAccount.mockRejectedValue(new Error('Network error'));

      await WalletsController.getBalance(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response
      );

      expect(mockedResponseUtil.error).toHaveBeenCalledWith(
        mockResponse,
        'Failed to retrieve balance information',
        502
      );
    });
  });

  describe('getTransactions', () => {
    it('should return transaction history successfully', async () => {
      const mockWallet = {
        id: 'wallet-id',
        stellar_public_key: generateUniqueStellarPublicKey(),
        status: 'active',
      };
      const mockTransactionResult = {
        transactions: [
          {
            id: '12884905984',
            hash: '2db4b22ca018119c5027a80578813ffcf582cda4aa9e31cd92b43cf1bda4fc5a',
            ledger: 3000000,
            createdAt: new Date().toISOString(),
            sourceAccount: mockWallet.stellar_public_key,
            operationCount: 1,
            successful: true,
          },
        ],
        hasMore: false,
        nextCursor: undefined,
      };

      mockRequest.query = { limit: '10', order: 'desc' };

      mockedWalletsService.getUserWallet.mockResolvedValue(mockWallet as any);
      mockedStellarService.accountExists.mockResolvedValue(true);
      mockedStellarService.getTransactionHistory.mockResolvedValue(mockTransactionResult as any);
      mockedWalletsService.logWalletEvent.mockResolvedValue(null);

      await WalletsController.getTransactions(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response
      );

      expect(mockedStellarService.getTransactionHistory).toHaveBeenCalledWith(
        mockWallet.stellar_public_key,
        undefined,
        10,
        'desc'
      );
      expect(mockedResponseUtil.success).toHaveBeenCalledWith(
        mockResponse,
        {
          transactions: mockTransactionResult.transactions,
          pagination: {
            cursor: mockTransactionResult.nextCursor,
            hasMore: mockTransactionResult.hasMore,
          },
        },
        'Transaction history retrieved successfully'
      );
    });

    it('should handle account not found on Stellar network', async () => {
      const mockWallet = {
        id: 'wallet-id',
        stellar_public_key: generateUniqueStellarPublicKey(),
        status: 'active',
      };

      mockedWalletsService.getUserWallet.mockResolvedValue(mockWallet as any);
      mockedStellarService.accountExists.mockResolvedValue(false);

      await WalletsController.getTransactions(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response
      );

      expect(mockedResponseUtil.success).toHaveBeenCalledWith(
        mockResponse,
        {
          transactions: [],
          pagination: { hasMore: false },
          message: 'Account not yet created on Stellar network',
        },
        'No transactions found'
      );
    });

    it('should return 404 when wallet not found', async () => {
      mockedWalletsService.getUserWallet.mockResolvedValue(null);

      await WalletsController.getTransactions(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response
      );

      expect(mockedResponseUtil.notFound).toHaveBeenCalledWith(
        mockResponse,
        'Wallet not found. Please create a wallet first.'
      );
    });
  });

  describe('requestPayout', () => {
    it('should create payout request successfully', async () => {
      const payoutData = {
        amount: '100.0000000',
        assetCode: 'XLM',
        destinationAddress: generateUniqueStellarPublicKey('DEST'),
        memo: 'Test payout',
      };
      const mockPayoutRequest = {
        id: 'payout-id',
        amount: payoutData.amount,
        asset_code: payoutData.assetCode,
        asset_issuer: null,
        destination_address: payoutData.destinationAddress,
        status: 'pending',
        requested_at: new Date(),
        memo: payoutData.memo,
      };

      mockRequest.body = payoutData;

      mockedWalletsService.createPayoutRequest.mockResolvedValue(mockPayoutRequest as any);

      await WalletsController.requestPayout(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response
      );

      expect(mockedWalletsService.createPayoutRequest).toHaveBeenCalledWith(user.id, payoutData);
      expect(mockedResponseUtil.created).toHaveBeenCalledWith(
        mockResponse,
        {
          id: mockPayoutRequest.id,
          amount: mockPayoutRequest.amount,
          assetCode: mockPayoutRequest.asset_code,
          assetIssuer: mockPayoutRequest.asset_issuer,
          destinationAddress: mockPayoutRequest.destination_address,
          status: mockPayoutRequest.status,
          requestedAt: mockPayoutRequest.requested_at.toISOString(),
          memo: mockPayoutRequest.memo,
        },
        'Payout request created successfully'
      );
    });

    it('should handle invalid destination address error', async () => {
      const payoutData = {
        amount: '100.0000000',
        assetCode: 'XLM',
        destinationAddress: 'INVALID_ADDRESS',
      };

      mockRequest.body = payoutData;

      mockedWalletsService.createPayoutRequest.mockRejectedValue(
        new Error('Invalid destination Stellar address')
      );

      await WalletsController.requestPayout(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response
      );

      expect(mockedResponseUtil.error).toHaveBeenCalledWith(
        mockResponse,
        'Invalid destination Stellar address',
        400
      );
    });

    it('should handle insufficient balance error', async () => {
      const payoutData = {
        amount: '1000.0000000',
        assetCode: 'XLM',
        destinationAddress: generateUniqueStellarPublicKey('DEST'),
      };

      mockRequest.body = payoutData;

      mockedWalletsService.createPayoutRequest.mockRejectedValue(
        new Error('Insufficient balance for payout request')
      );

      await WalletsController.requestPayout(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response
      );

      expect(mockedResponseUtil.error).toHaveBeenCalledWith(
        mockResponse,
        'Insufficient balance for payout request',
        409
      );
    });

    it('should handle duplicate address error', async () => {
      const payoutData = {
        amount: '100.0000000',
        assetCode: 'XLM',
        destinationAddress: generateUniqueStellarPublicKey('DEST'),
      };

      mockRequest.body = payoutData;

      mockedWalletsService.createPayoutRequest.mockRejectedValue(
        new Error('Stellar address already associated with another wallet')
      );

      await WalletsController.requestPayout(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response
      );

      expect(mockedResponseUtil.error).toHaveBeenCalledWith(
        mockResponse,
        'Stellar address already associated with another wallet',
        409
      );
    });

    it('should handle general service errors', async () => {
      const payoutData = {
        amount: '100.0000000',
        assetCode: 'XLM',
        destinationAddress: generateUniqueStellarPublicKey('DEST'),
      };

      mockRequest.body = payoutData;

      mockedWalletsService.createPayoutRequest.mockRejectedValue(new Error('Database error'));

      await WalletsController.requestPayout(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response
      );

      expect(mockedResponseUtil.error).toHaveBeenCalledWith(
        mockResponse,
        'Failed to create payout request',
        500
      );
    });
  });

  describe('addTrustline', () => {
    it('should create trustline operation successfully', async () => {
      const trustlineData = {
        assetCode: 'USD',
        assetIssuer: generateUniqueStellarPublicKey('ISSUER'),
        limit: '1000.0000000',
      };
      const mockWallet = {
        id: 'wallet-id',
        stellar_public_key: generateUniqueStellarPublicKey(),
        status: 'active',
      };
      const mockOperation = {
        type: 'change_trust',
        asset: { code: trustlineData.assetCode, issuer: trustlineData.assetIssuer },
        limit: trustlineData.limit,
      };

      mockRequest.body = trustlineData;

      mockedWalletsService.getUserWallet.mockResolvedValue(mockWallet as any);
      mockedWalletsService.hasTrustline.mockResolvedValue(false);
      mockedStellarService.createTrustlineOperation.mockReturnValue(mockOperation as any);
      mockedWalletsService.logWalletEvent.mockResolvedValue(null);

      await WalletsController.addTrustline(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response
      );

      expect(mockedWalletsService.hasTrustline).toHaveBeenCalledWith(
        user.id,
        trustlineData.assetCode,
        trustlineData.assetIssuer
      );
      expect(mockedStellarService.createTrustlineOperation).toHaveBeenCalledWith(
        trustlineData.assetCode,
        trustlineData.assetIssuer,
        trustlineData.limit
      );
      expect(mockedResponseUtil.success).toHaveBeenCalledWith(
        mockResponse,
        {
          message: 'Trustline operation created successfully',
          operation: {
            type: 'change_trust',
            assetCode: trustlineData.assetCode,
            assetIssuer: trustlineData.assetIssuer,
            limit: trustlineData.limit,
          },
        },
        'Trustline operation prepared successfully'
      );
    });

    it('should return 404 when wallet not found', async () => {
      const trustlineData = {
        assetCode: 'USD',
        assetIssuer: generateUniqueStellarPublicKey('ISSUER'),
      };

      mockRequest.body = trustlineData;

      mockedWalletsService.getUserWallet.mockResolvedValue(null);

      await WalletsController.addTrustline(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response
      );

      expect(mockedResponseUtil.notFound).toHaveBeenCalledWith(
        mockResponse,
        'Wallet not found. Please create a wallet first.'
      );
    });

    it('should return 409 when trustline already exists', async () => {
      const trustlineData = {
        assetCode: 'USD',
        assetIssuer: generateUniqueStellarPublicKey('ISSUER'),
      };
      const mockWallet = {
        id: 'wallet-id',
        stellar_public_key: generateUniqueStellarPublicKey(),
        status: 'active',
      };

      mockRequest.body = trustlineData;

      mockedWalletsService.getUserWallet.mockResolvedValue(mockWallet as any);
      mockedWalletsService.hasTrustline.mockResolvedValue(true);

      await WalletsController.addTrustline(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response
      );

      expect(mockedResponseUtil.conflict).toHaveBeenCalledWith(
        mockResponse,
        'Trustline already exists for this asset'
      );
    });

    it('should handle invalid asset issuer error', async () => {
      const trustlineData = {
        assetCode: 'USD',
        assetIssuer: 'INVALID_ISSUER',
      };
      const mockWallet = {
        id: 'wallet-id',
        stellar_public_key: generateUniqueStellarPublicKey(),
        status: 'active',
      };

      mockRequest.body = trustlineData;

      mockedWalletsService.getUserWallet.mockResolvedValue(mockWallet as any);
      mockedWalletsService.hasTrustline.mockResolvedValue(false);
      mockedStellarService.createTrustlineOperation.mockImplementation(() => {
        throw new Error('Invalid asset issuer public key');
      });

      await WalletsController.addTrustline(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response
      );

      expect(mockedResponseUtil.error).toHaveBeenCalledWith(
        mockResponse,
        'Invalid asset issuer public key',
        400
      );
    });
  });

  describe('getEarnings', () => {
    it('should return earnings summary successfully', async () => {
      const mockEarningsSummary = {
        totalEarnings: '1250.75',
        currentPeriodEarnings: '350.25',
        recentTransactions: [
          {
            id: 'tx-1',
            amount: '50.00',
            assetCode: 'USD',
            date: new Date().toISOString(),
            type: 'session_payment' as const,
          },
        ],
        periodSummary: {
          startDate: new Date().toISOString(),
          endDate: new Date().toISOString(),
          sessionCount: 15,
          averageEarning: '23.35',
        },
      };

      mockRequest.query = { startDate: '2024-01-01', endDate: '2024-01-31', assetCode: 'USD' };

      mockedWalletsService.getEarningsSummary.mockResolvedValue(mockEarningsSummary);

      await WalletsController.getEarnings(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response
      );

      expect(mockedWalletsService.getEarningsSummary).toHaveBeenCalledWith(
        user.id,
        '2024-01-01',
        '2024-01-31',
        'USD'
      );
      expect(mockedResponseUtil.success).toHaveBeenCalledWith(
        mockResponse,
        mockEarningsSummary,
        'Earnings summary retrieved successfully'
      );
    });

    it('should handle service errors', async () => {
      mockedWalletsService.getEarningsSummary.mockRejectedValue(new Error('Database error'));

      await WalletsController.getEarnings(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response
      );

      expect(mockedResponseUtil.error).toHaveBeenCalledWith(
        mockResponse,
        'Failed to retrieve earnings summary',
        500
      );
    });
  });

  describe('getPayoutRequests', () => {
    it('should return payout requests successfully', async () => {
      const mockPayoutRequests = [
        {
          id: 'payout-1',
          amount: '100.0000000',
          asset_code: 'XLM',
          asset_issuer: null,
          destination_address: generateUniqueStellarPublicKey('DEST1'),
          status: 'pending',
          memo: 'Test payout 1',
          requested_at: new Date(),
          processed_at: null,
          transaction_hash: null,
          notes: null,
        },
        {
          id: 'payout-2',
          amount: '50.0000000',
          asset_code: 'USD',
          asset_issuer: generateUniqueStellarPublicKey('ISSUER'),
          destination_address: generateUniqueStellarPublicKey('DEST2'),
          status: 'completed',
          memo: 'Test payout 2',
          requested_at: new Date(),
          processed_at: new Date(),
          transaction_hash: 'tx-hash-123',
          notes: 'Completed successfully',
        },
      ];

      mockRequest.query = { page: '1', limit: '10' };

      mockedWalletsService.getUserPayoutRequests.mockResolvedValue(mockPayoutRequests as any);

      await WalletsController.getPayoutRequests(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response
      );

      expect(mockedWalletsService.getUserPayoutRequests).toHaveBeenCalledWith(user.id, 10, 0);
      expect(mockedResponseUtil.success).toHaveBeenCalledWith(
        mockResponse,
        {
          payoutRequests: [
            {
              id: mockPayoutRequests[0].id,
              amount: mockPayoutRequests[0].amount,
              assetCode: mockPayoutRequests[0].asset_code,
              assetIssuer: mockPayoutRequests[0].asset_issuer,
              destinationAddress: mockPayoutRequests[0].destination_address,
              status: mockPayoutRequests[0].status,
              memo: mockPayoutRequests[0].memo,
              requestedAt: mockPayoutRequests[0].requested_at.toISOString(),
              processedAt: mockPayoutRequests[0].processed_at,
              transactionHash: mockPayoutRequests[0].transaction_hash,
              notes: mockPayoutRequests[0].notes,
            },
            {
              id: mockPayoutRequests[1].id,
              amount: mockPayoutRequests[1].amount,
              assetCode: mockPayoutRequests[1].asset_code,
              assetIssuer: mockPayoutRequests[1].asset_issuer,
              destinationAddress: mockPayoutRequests[1].destination_address,
              status: mockPayoutRequests[1].status,
              memo: mockPayoutRequests[1].memo,
              requestedAt: mockPayoutRequests[1].requested_at.toISOString(),
              processedAt: mockPayoutRequests[1].processed_at!.toISOString(),
              transactionHash: mockPayoutRequests[1].transaction_hash,
              notes: mockPayoutRequests[1].notes,
            },
          ],
          pagination: {
            page: 1,
            limit: 10,
            hasMore: false,
          },
        },
        'Payout requests retrieved successfully'
      );
    });

    it('should handle pagination parameters', async () => {
      mockRequest.query = { page: '2', limit: '5' };

      mockedWalletsService.getUserPayoutRequests.mockResolvedValue([]);

      await WalletsController.getPayoutRequests(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response
      );

      expect(mockedWalletsService.getUserPayoutRequests).toHaveBeenCalledWith(user.id, 5, 5);
    });

    it('should handle service errors', async () => {
      mockedWalletsService.getUserPayoutRequests.mockRejectedValue(new Error('Database error'));

      await WalletsController.getPayoutRequests(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response
      );

      expect(mockedResponseUtil.error).toHaveBeenCalledWith(
        mockResponse,
        'Failed to retrieve payout requests',
        500
      );
    });
  });
});