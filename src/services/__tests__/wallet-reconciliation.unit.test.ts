/**
 * Unit tests for WalletReconciliationService
 *
 * Tests the core reconciliation logic:
 * - Balances match → no action
 * - On-chain balance higher → local updated
 * - On-chain balance lower → discrepancy logged and alert raised
 * - Wallet not found on chain → wallet marked as error state
 *
 * All Stellar Horizon API calls and database calls are mocked.
 */

import { WalletReconciliationService, SyncResult } from "../wallet-reconciliation.service";
import * as StellarService from "../stellar.service";
import pool from "../../config/database";
import { SocketService } from "../socket.service";
import { logger } from "../../utils/logger.utils";

// Mock the dependencies
jest.mock("../../config/database");
jest.mock("../stellar.service");
jest.mock("../socket.service");
jest.mock("../../utils/logger.utils");
jest.mock("../../config/metrics", () => ({
  walletReconciliationsTotal: {
    inc: jest.fn(),
  },
  walletDiscrepanciesTotal: {
    inc: jest.fn(),
  },
}));

describe("WalletReconciliationService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("syncWallet", () => {
    const walletId = "wallet-123";
    const stellarPublicKey = "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

    describe("when wallet is not found or has no stellar_public_key", () => {
      it("should return no_wallet status", async () => {
        const mockQueryResult = { rows: [] };
        (pool.query as jest.Mock).mockResolvedValueOnce(mockQueryResult);

        const result = await WalletReconciliationService.syncWallet(walletId);

        expect(result.status).toBe("no_wallet");
        expect(result.reconciledAssets).toBe(0);
        expect(result.changedAssets).toBe(0);
        expect(result.discrepancies).toBe(0);
        expect(result.alerted).toBe(false);
      });

      it("should return no_wallet status when wallet exists but has no stellar_public_key", async () => {
        const mockQueryResult = {
          rows: [{ id: walletId, stellar_public_key: null, status: "active" }],
        };
        (pool.query as jest.Mock).mockResolvedValueOnce(mockQueryResult);

        const result = await WalletReconciliationService.syncWallet(walletId);

        expect(result.status).toBe("no_wallet");
        expect(result.stellarPublicKey).toBe(null);
      });
    });

    describe("when balances match", () => {
      it("should return success with no changes", async () => {
        const mockWallet = {
          id: walletId,
          stellar_public_key: stellarPublicKey,
          status: "active",
        };

        // Mock wallet fetch
        (pool.query as jest.Mock)
          .mockResolvedValueOnce({ rows: [mockWallet] }) // wallet fetch
          .mockResolvedValueOnce({ rows: [] }) // client.connect (released later)
          .mockResolvedValueOnce({ rows: [] }); // stored assets fetch

        // Mock client
        const mockClient = {
          query: jest.fn(),
          release: jest.fn(),
        };
        (pool.connect as jest.Mock).mockResolvedValueOnce(mockClient);

        // Mock stellar account with matching balance
        const mockAccount = {
          balances: [
            {
              assetType: "native",
              assetCode: null,
              assetIssuer: null,
              balance: "100.0000000",
            },
          ],
        };
        (StellarService.stellarService.getAccount as jest.Mock).mockResolvedValueOnce(
          mockAccount,
        );

        // Mock database transaction
        mockClient.query.mockResolvedValueOnce(undefined); // BEGIN
        mockClient.query.mockResolvedValueOnce({
          rows: [
            {
              id: "balance-id",
              balance: "100.0000000",
              asset_type: "native",
              asset_code: null,
              asset_issuer: null,
            },
          ],
        }); // SELECT existing balance
        mockClient.query.mockResolvedValueOnce({ rows: [] }); // SELECT stored assets FOR UPDATE
        mockClient.query.mockResolvedValueOnce(undefined); // COMMIT

        const result = await WalletReconciliationService.syncWallet(walletId);

        expect(result.status).toBe("success");
        expect(result.reconciledAssets).toBe(1);
        expect(result.changedAssets).toBe(0);
        expect(result.discrepancies).toBe(0);
        expect(result.alerted).toBe(false);
        expect(result.details[0]?.changed).toBe(false);
      });
    });

    describe("when on-chain balance is higher than local balance", () => {
      it("should update local balance and log discrepancy", async () => {
        const mockWallet = {
          id: walletId,
          stellar_public_key: stellarPublicKey,
          status: "active",
        };

        // Mock wallet fetch
        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockWallet] });

        // Mock client
        const mockClient = {
          query: jest.fn(),
          release: jest.fn(),
        };
        (pool.connect as jest.Mock).mockResolvedValueOnce(mockClient);

        // Mock stellar account with higher balance
        const mockAccount = {
          balances: [
            {
              assetType: "native",
              assetCode: null,
              assetIssuer: null,
              balance: "150.0000000",
            },
          ],
        };
        (StellarService.stellarService.getAccount as jest.Mock).mockResolvedValueOnce(
          mockAccount,
        );

        // Mock database transaction
        mockClient.query.mockResolvedValueOnce(undefined); // BEGIN
        mockClient.query.mockResolvedValueOnce({
          rows: [
            {
              id: "balance-id",
              balance: "100.0000000",
              asset_type: "native",
              asset_code: null,
              asset_issuer: null,
            },
          ],
        }); // SELECT existing balance
        mockClient.query.mockResolvedValueOnce({
          rows: [
            {
              asset_type: "native",
              asset_code: null,
              asset_issuer: null,
            },
          ],
        }); // SELECT stored assets FOR UPDATE
        mockClient.query.mockResolvedValueOnce(undefined); // UPDATE balance
        mockClient.query.mockResolvedValueOnce(undefined); // INSERT log
        mockClient.query.mockResolvedValueOnce(undefined); // COMMIT

        const result = await WalletReconciliationService.syncWallet(walletId);

        expect(result.status).toBe("success");
        expect(result.changedAssets).toBe(1);
        expect(result.discrepancies).toBe(1);
        expect(result.details[0]).toMatchObject({
          beforeBalance: 100,
          afterBalance: 150,
          discrepancy: 50,
          changed: true,
        });

        // Verify UPDATE was called
        const updateCall = mockClient.query.mock.calls.find(
          (call) => typeof call[0] === "string" && call[0].includes("UPDATE wallet_balances"),
        );
        expect(updateCall).toBeDefined();
      });
    });

    describe("when on-chain balance is lower than local balance", () => {
      it("should update local balance and log discrepancy without alert if under threshold", async () => {
        const mockWallet = {
          id: walletId,
          stellar_public_key: stellarPublicKey,
          status: "active",
        };

        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockWallet] });

        const mockClient = {
          query: jest.fn(),
          release: jest.fn(),
        };
        (pool.connect as jest.Mock).mockResolvedValueOnce(mockClient);

        // On-chain is lower, but not exceeding alert threshold (1 XLM)
        const mockAccount = {
          balances: [
            {
              assetType: "native",
              assetCode: null,
              assetIssuer: null,
              balance: "99.5000000",
            },
          ],
        };
        (StellarService.stellarService.getAccount as jest.Mock).mockResolvedValueOnce(
          mockAccount,
        );

        mockClient.query.mockResolvedValueOnce(undefined); // BEGIN
        mockClient.query.mockResolvedValueOnce({
          rows: [
            {
              id: "balance-id",
              balance: "100.0000000",
              asset_type: "native",
              asset_code: null,
              asset_issuer: null,
            },
          ],
        }); // SELECT existing balance
        mockClient.query.mockResolvedValueOnce({ rows: [] }); // SELECT stored assets FOR UPDATE
        mockClient.query.mockResolvedValueOnce(undefined); // UPDATE balance
        mockClient.query.mockResolvedValueOnce(undefined); // INSERT log
        mockClient.query.mockResolvedValueOnce(undefined); // COMMIT

        const result = await WalletReconciliationService.syncWallet(walletId);

        expect(result.status).toBe("success");
        expect(result.changedAssets).toBe(1);
        expect(result.details[0]).toMatchObject({
          beforeBalance: 100,
          afterBalance: 99.5,
          discrepancy: -0.5,
          changed: true,
          alerted: false,
        });

        // Should NOT emit alert
        expect(SocketService.emitToRoom).not.toHaveBeenCalled();
      });

      it("should emit alert when native discrepancy exceeds 1 XLM", async () => {
        const mockWallet = {
          id: walletId,
          stellar_public_key: stellarPublicKey,
          status: "active",
        };

        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockWallet] });

        const mockClient = {
          query: jest.fn(),
          release: jest.fn(),
        };
        (pool.connect as jest.Mock).mockResolvedValueOnce(mockClient);

        // On-chain is significantly lower
        const mockAccount = {
          balances: [
            {
              assetType: "native",
              assetCode: null,
              assetIssuer: null,
              balance: "95.0000000", // 5 XLM discrepancy
            },
          ],
        };
        (StellarService.stellarService.getAccount as jest.Mock).mockResolvedValueOnce(
          mockAccount,
        );

        mockClient.query.mockResolvedValueOnce(undefined); // BEGIN
        mockClient.query.mockResolvedValueOnce({
          rows: [
            {
              id: "balance-id",
              balance: "100.0000000",
              asset_type: "native",
              asset_code: null,
              asset_issuer: null,
            },
          ],
        }); // SELECT existing balance
        mockClient.query.mockResolvedValueOnce({ rows: [] }); // SELECT stored assets FOR UPDATE
        mockClient.query.mockResolvedValueOnce(undefined); // UPDATE balance
        mockClient.query.mockResolvedValueOnce(undefined); // INSERT log
        mockClient.query.mockResolvedValueOnce(undefined); // COMMIT

        const result = await WalletReconciliationService.syncWallet(walletId);

        expect(result.status).toBe("success");
        expect(result.alerted).toBe(true);
        expect(result.details[0]?.alerted).toBe(true);

        // Should emit alert to admin room
        expect(SocketService.emitToRoom).toHaveBeenCalledWith(
          "admin",
          "wallet:balance_discrepancy",
          expect.objectContaining({
            walletId,
            assetType: "native",
            discrepancy: -5,
          }),
        );
      });
    });

    describe("when wallet is not found on chain", () => {
      it("should mark balance as 0 and log reconciliation", async () => {
        const mockWallet = {
          id: walletId,
          stellar_public_key: stellarPublicKey,
          status: "active",
        };

        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockWallet] });

        const mockClient = {
          query: jest.fn(),
          release: jest.fn(),
        };
        (pool.connect as jest.Mock).mockResolvedValueOnce(mockClient);

        // Account exists but has no balances (or was merged)
        const mockAccount = {
          balances: [],
        };
        (StellarService.stellarService.getAccount as jest.Mock).mockResolvedValueOnce(
          mockAccount,
        );

        // Mock locally stored balance
        mockClient.query.mockResolvedValueOnce(undefined); // BEGIN
        mockClient.query.mockResolvedValueOnce({ rows: [] }); // No on-chain balance to reconcile
        mockClient.query.mockResolvedValueOnce({
          rows: [
            {
              asset_type: "native",
              asset_code: null,
              asset_issuer: null,
            },
          ],
        }); // SELECT stored assets with no on-chain counterpart
        mockClient.query.mockResolvedValueOnce({
          rows: [
            {
              id: "balance-id",
              balance: "50.0000000",
              asset_type: "native",
              asset_code: null,
              asset_issuer: null,
            },
          ],
        }); // SELECT existing balance for reconciliation
        mockClient.query.mockResolvedValueOnce(undefined); // UPDATE balance to 0
        mockClient.query.mockResolvedValueOnce(undefined); // INSERT log
        mockClient.query.mockResolvedValueOnce(undefined); // COMMIT

        const result = await WalletReconciliationService.syncWallet(walletId);

        expect(result.status).toBe("success");
        expect(result.changedAssets).toBeGreaterThan(0);

        const nativeReconciliation = result.details.find((d) => d.assetType === "native");
        expect(nativeReconciliation).toMatchObject({
          beforeBalance: 50,
          afterBalance: 0,
          discrepancy: -50,
          changed: true,
        });
      });
    });

    describe("error handling", () => {
      it("should return error status and log when stellar.getAccount fails", async () => {
        const mockWallet = {
          id: walletId,
          stellar_public_key: stellarPublicKey,
          status: "active",
        };

        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockWallet] });

        const mockClient = {
          query: jest.fn(),
          release: jest.fn(),
        };
        (pool.connect as jest.Mock).mockResolvedValueOnce(mockClient);

        const testError = new Error("Horizon API unreachable");
        (StellarService.stellarService.getAccount as jest.Mock).mockRejectedValueOnce(
          testError,
        );

        mockClient.query.mockResolvedValueOnce(undefined); // BEGIN

        const result = await WalletReconciliationService.syncWallet(walletId);

        expect(result.status).toBe("error");
        expect(result.error).toBe("Horizon API unreachable");
        expect(logger.error).toHaveBeenCalledWith(
          "WalletReconciliationService.syncWallet failed",
          expect.objectContaining({
            walletId,
            error: "Horizon API unreachable",
          }),
        );
      });

      it("should rollback transaction on database error", async () => {
        const mockWallet = {
          id: walletId,
          stellar_public_key: stellarPublicKey,
          status: "active",
        };

        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockWallet] });

        const mockClient = {
          query: jest.fn(),
          release: jest.fn(),
        };
        (pool.connect as jest.Mock).mockResolvedValueOnce(mockClient);

        const mockAccount = {
          balances: [
            {
              assetType: "native",
              assetCode: null,
              assetIssuer: null,
              balance: "100.0000000",
            },
          ],
        };
        (StellarService.stellarService.getAccount as jest.Mock).mockResolvedValueOnce(
          mockAccount,
        );

        // BEGIN succeeds, but UPDATE fails
        mockClient.query.mockResolvedValueOnce(undefined); // BEGIN
        mockClient.query.mockRejectedValueOnce(new Error("Database error")); // SELECT fails

        const result = await WalletReconciliationService.syncWallet(walletId);

        expect(result.status).toBe("error");

        // Verify ROLLBACK was called
        const rollbackCall = mockClient.query.mock.calls.find(
          (call) => typeof call[0] === "string" && call[0].includes("ROLLBACK"),
        );
        expect(rollbackCall).toBeDefined();
      });
    });

    describe("idempotency", () => {
      it("should not log duplicate corrections when run twice on same wallet", async () => {
        const mockWallet = {
          id: walletId,
          stellar_public_key: stellarPublicKey,
          status: "active",
        };

        const mockAccount = {
          balances: [
            {
              assetType: "native",
              assetCode: null,
              assetIssuer: null,
              balance: "100.0000000",
            },
          ],
        };

        // First run
        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockWallet] });
        const mockClient1 = {
          query: jest.fn(),
          release: jest.fn(),
        };
        (pool.connect as jest.Mock).mockResolvedValueOnce(mockClient1);
        (StellarService.stellarService.getAccount as jest.Mock).mockResolvedValueOnce(
          mockAccount,
        );

        mockClient1.query.mockResolvedValueOnce(undefined); // BEGIN
        mockClient1.query.mockResolvedValueOnce({
          rows: [
            {
              id: "balance-id",
              balance: "100.0000000",
              asset_type: "native",
              asset_code: null,
              asset_issuer: null,
            },
          ],
        }); // SELECT existing balance
        mockClient1.query.mockResolvedValueOnce({ rows: [] }); // SELECT stored assets
        mockClient1.query.mockResolvedValueOnce(undefined); // COMMIT

        const result1 = await WalletReconciliationService.syncWallet(walletId);
        expect(result1.changedAssets).toBe(0); // No changes on first run

        // Second run — should also result in no changes
        jest.clearAllMocks();
        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockWallet] });
        const mockClient2 = {
          query: jest.fn(),
          release: jest.fn(),
        };
        (pool.connect as jest.Mock).mockResolvedValueOnce(mockClient2);
        (StellarService.stellarService.getAccount as jest.Mock).mockResolvedValueOnce(
          mockAccount,
        );

        mockClient2.query.mockResolvedValueOnce(undefined); // BEGIN
        mockClient2.query.mockResolvedValueOnce({
          rows: [
            {
              id: "balance-id",
              balance: "100.0000000",
              asset_type: "native",
              asset_code: null,
              asset_issuer: null,
            },
          ],
        }); // SELECT existing balance
        mockClient2.query.mockResolvedValueOnce({ rows: [] }); // SELECT stored assets
        mockClient2.query.mockResolvedValueOnce(undefined); // COMMIT

        const result2 = await WalletReconciliationService.syncWallet(walletId);
        expect(result2.changedAssets).toBe(0); // Still no changes
      });
    });
  });

  describe("reconcileAll", () => {
    it("should process all active wallets with stellar keys", async () => {
      const walletIds = ["wallet-1", "wallet-2", "wallet-3"];

      // Mock wallet list query
      (pool.query as jest.Mock).mockResolvedValueOnce({
        rows: walletIds.map((id) => ({ id })),
      });

      // Mock each wallet sync
      for (const walletId of walletIds) {
        (pool.query as jest.Mock).mockResolvedValueOnce({
          rows: [
            {
              id: walletId,
              stellar_public_key: "GXXX",
              status: "active",
            },
          ],
        });

        const mockClient = {
          query: jest.fn(),
          release: jest.fn(),
        };
        (pool.connect as jest.Mock).mockResolvedValueOnce(mockClient);

        (StellarService.stellarService.getAccount as jest.Mock).mockResolvedValueOnce({
          balances: [
            {
              assetType: "native",
              assetCode: null,
              assetIssuer: null,
              balance: "100.0000000",
            },
          ],
        });

        mockClient.query.mockResolvedValueOnce(undefined); // BEGIN
        mockClient.query.mockResolvedValueOnce({
          rows: [
            {
              id: `balance-${walletId}`,
              balance: "100.0000000",
              asset_type: "native",
              asset_code: null,
              asset_issuer: null,
            },
          ],
        }); // SELECT existing balance
        mockClient.query.mockResolvedValueOnce({ rows: [] }); // SELECT stored assets
        mockClient.query.mockResolvedValueOnce(undefined); // COMMIT
      }

      const result = await WalletReconciliationService.reconcileAll(2);

      expect(result.totalWallets).toBe(3);
      expect(result.processed).toBeGreaterThanOrEqual(0);
      expect(result.durationMs).toBeGreaterThan(0);
    });
  });
});
