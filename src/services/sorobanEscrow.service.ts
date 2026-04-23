import { z } from 'zod';
import pool from '../config/database';
import { logger } from '../utils/logger.utils';
import {
  executeSorobanInvocation,
  normalizeSplitPercentage,
  asStringId,
  SOROBAN_POLL_INTERVAL_MS,
} from '../utils/soroban.utils';
import * as StellarSdk from '@stellar/stellar-sdk';

type EscrowContractMethod =
  | 'create_escrow'
  | 'release_funds'
  | 'refund'
  | 'open_dispute'
  | 'resolve_dispute'
  | 'get_escrow';

interface SorobanContractInvocation {
  contractAddress: string;
  method: EscrowContractMethod;
  args: unknown[];
}

export interface SorobanEscrowState {
  status: string;
  escrowId?: string;
  txHash?: string | null;
}

export interface SorobanInvocationResult {
  txHash: string | null;
  result: unknown;
}

export interface SorobanEscrowClient {
  simulate(params: SorobanContractInvocation): Promise<void>;
  invoke(params: SorobanContractInvocation): Promise<SorobanInvocationResult>;
  getEscrowState(
    contractAddress: string,
    escrowId: string,
  ): Promise<SorobanEscrowState>;
  streamPendingEscrows?(
    contractAddress: string,
    onState: (state: SorobanEscrowState) => Promise<void> | void,
  ): Promise<() => void> | (() => void);
}

export interface CreateSorobanEscrowInput {
  bookingId: string;
  learnerId: string;
  mentorId: string;
  amount: string;
  currency: string;
}

export interface ReleaseSorobanEscrowInput {
  escrowId: string;
  releasedBy: string;
  contractAddress?: string;
}

export interface RefundSorobanEscrowInput {
  escrowId: string;
  refundedBy: string;
  contractAddress?: string;
  amount?: string;
}

export interface OpenSorobanDisputeInput {
  escrowId: string;
  raisedBy: string;
  reason: string;
  contractAddress?: string;
}

export interface ResolveSorobanDisputeInput {
  escrowId: string;
  splitPercentage: number;
  resolvedBy: string;
  contractAddress?: string;
}

class StellarSorobanClient implements SorobanEscrowClient {
  private readonly rpcServer: any;
  private readonly keypair: any;
  private readonly networkPassphrase: string;

  constructor() {
    const sdkAny = StellarSdk as any;
    const serverUrl =
      process.env.SOROBAN_RPC_URL ||
      process.env.STELLAR_RPC_URL ||
      process.env.STELLAR_HORIZON_URL ||
      'https://soroban-testnet.stellar.org';

    const RpcServerCtor = sdkAny.SorobanRpc?.Server || sdkAny.rpc?.Server;
    this.rpcServer = RpcServerCtor ? new RpcServerCtor(serverUrl) : null;

    this.keypair = process.env.PLATFORM_SECRET_KEY
      ? sdkAny.Keypair.fromSecret(process.env.PLATFORM_SECRET_KEY)
      : null;

    this.networkPassphrase =
      process.env.STELLAR_NETWORK === 'mainnet'
        ? sdkAny.Networks.PUBLIC
        : sdkAny.Networks.TESTNET;
  }

  async simulate(params: SorobanContractInvocation): Promise<void> {
    const tx = await this.buildContractTransaction(params);
    const simulation = await this.rpcServer.simulateTransaction(tx);

    if (simulation?.error) {
      throw new Error(String(simulation.error));
    }
  }

  async invoke(params: SorobanContractInvocation): Promise<SorobanInvocationResult> {
    const sdkAny = StellarSdk as any;
    const SorobanRpc = sdkAny.SorobanRpc || sdkAny.rpc;
    const tx = await this.buildContractTransaction(params);
    const simulation = await this.rpcServer.simulateTransaction(tx);

    if (simulation?.error) {
      throw new Error(String(simulation.error));
    }

    let preparedTx: any = tx;
    if (SorobanRpc?.assembleTransaction) {
      const assembled = SorobanRpc.assembleTransaction(tx, simulation);
      preparedTx = assembled?.build ? assembled.build() : assembled;
    }

    if (this.keypair && typeof preparedTx?.sign === 'function') {
      preparedTx.sign(this.keypair);
    }

    const response = await this.rpcServer.sendTransaction(preparedTx);

    return {
      txHash: asStringId(response?.hash) || asStringId(response?.id),
      result: response,
    };
  }

  async getEscrowState(
    contractAddress: string,
    escrowId: string,
  ): Promise<SorobanEscrowState> {
    const response = await this.invoke({
      contractAddress,
      method: 'get_escrow',
      args: [escrowId],
    });

    return parseEscrowState(response.result, escrowId, response.txHash);
  }

  private async buildContractTransaction(
    params: SorobanContractInvocation,
  ): Promise<any> {
    const sdkAny = StellarSdk as any;

    if (!this.rpcServer) {
      throw new Error('Soroban RPC client is not available in @stellar/stellar-sdk');
    }

    const sourcePublicKey =
      this.keypair?.publicKey?.() || process.env.PLATFORM_PUBLIC_KEY;

    if (!sourcePublicKey) {
      throw new Error('PLATFORM_PUBLIC_KEY or PLATFORM_SECRET_KEY is required for Soroban calls');
    }

    const account = await this.rpcServer.getAccount(sourcePublicKey);
    const contract = new sdkAny.Contract(params.contractAddress);
    const args = params.args.map((arg) => this.toScVal(arg));
    const fee = String(sdkAny.BASE_FEE || '100');

    return new sdkAny.TransactionBuilder(account, {
      fee,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(params.method, ...args))
      .setTimeout(30)
      .build();
  }

  private toScVal(value: unknown): unknown {
    const sdkAny = StellarSdk as any;
    if (typeof sdkAny.nativeToScVal === 'function') {
      return sdkAny.nativeToScVal(value as any);
    }
    return value;
  }
}

const CreateEscrowResponseSchema = z.object({
  escrowId: z.string(),
}).passthrough();

class SorobanEscrowServiceImpl {
  private pollTimer: NodeJS.Timeout | null = null;
  private stopStream: (() => void) | null = null;
  private monitoringStarted = false;

  constructor(private client: SorobanEscrowClient) {}

  setClient(client: SorobanEscrowClient): void {
    this.client = client;
  }

  isConfigured(): boolean {
    return Boolean(this.getDefaultContractAddress());
  }

  async createEscrow(input: CreateSorobanEscrowInput): Promise<{
    contractAddress: string;
    escrowId: string;
    txHash: string | null;
  }> {
    const contractAddress = this.requireContractAddress();
    const invocation = {
      contractAddress,
      method: 'create_escrow' as const,
      args: [
        input.bookingId,
        input.learnerId,
        input.mentorId,
        input.amount,
        input.currency,
      ],
    };

    const tx = await executeSorobanInvocation(
      {
        simulate: (args) => this.client.simulate(args),
        submit: (args) => this.client.invoke(args),
      },
      invocation,
      {
        method: invocation.method,
        contractAddress,
        entityId: input.bookingId,
        userId: input.learnerId,
      },
    );

    // Validate the transaction result against the schema
    const validationResult = CreateEscrowResponseSchema.safeParse(tx.result);
    if (!validationResult.success) {
      logger.error('Soroban create_escrow response validation failed', {
        bookingId: input.bookingId,
        txHash: tx.txHash,
        txResult: tx.result,
        validationErrors: validationResult.error.errors,
      });
      throw new Error(`Invalid create_escrow response for booking ${input.bookingId}.`);
    }

    const extractedEscrowId = extractEscrowIdFromResult(tx.result);

    if (!extractedEscrowId) {
      logger.warn('Failed to extract escrowId from create_escrow transaction result. Falling back to bookingId.', {
        bookingId: input.bookingId,
        txHash: tx.txHash,
        txResult: tx.result,
      });
      throw new Error(`Failed to create escrow for booking ${input.bookingId}: could not extract escrow ID from contract response.`);
    }

    const escrowId = extractedEscrowId;

    return {
      contractAddress,
      escrowId,
      txHash: tx.txHash,
    };
  }

  async releaseFunds(input: ReleaseSorobanEscrowInput): Promise<SorobanInvocationResult> {
    const contractAddress = this.resolveContractAddress(input.contractAddress);
    const invocation = {
      contractAddress,
      method: 'release_funds' as const,
      args: [input.escrowId],
    };

    return executeSorobanInvocation(
      {
        simulate: (args) => this.client.simulate(args),
        submit: (args) => this.client.invoke(args),
      },
      invocation,
      {
        method: invocation.method,
        contractAddress,
        entityId: input.escrowId,
        userId: input.releasedBy,
      },
    );
  }

  async refund(input: RefundSorobanEscrowInput): Promise<SorobanInvocationResult> {
    const contractAddress = this.resolveContractAddress(input.contractAddress);
    const args = [input.escrowId];
    if (input.amount) {
      args.push(input.amount);
    }
    const invocation = {
      contractAddress,
      method: 'refund' as const,
      args,
    };

    return executeSorobanInvocation(
      {
        simulate: (args) => this.client.simulate(args),
        submit: (args) => this.client.invoke(args),
      },
      invocation,
      {
        method: invocation.method,
        contractAddress,
        entityId: input.escrowId,
        userId: input.refundedBy,
      },
    );
  }

  async openDispute(input: OpenSorobanDisputeInput): Promise<SorobanInvocationResult> {
    const contractAddress = this.resolveContractAddress(input.contractAddress);
    const invocation = {
      contractAddress,
      method: 'open_dispute' as const,
      args: [input.escrowId, input.reason],
    };

    return executeSorobanInvocation(
      {
        simulate: (args) => this.client.simulate(args),
        submit: (args) => this.client.invoke(args),
      },
      invocation,
      {
        method: invocation.method,
        contractAddress,
        entityId: input.escrowId,
        userId: input.raisedBy,
      },
    );
  }

  async resolveDispute(
    input: ResolveSorobanDisputeInput,
  ): Promise<SorobanInvocationResult> {
    const contractAddress = this.resolveContractAddress(input.contractAddress);
    const splitPercentage = normalizeSplitPercentage(input.splitPercentage);
    const invocation = {
      contractAddress,
      method: 'resolve_dispute' as const,
      args: [input.escrowId, splitPercentage],
    };

    return executeSorobanInvocation(
      {
        simulate: (args) => this.client.simulate(args),
        submit: (args) => this.client.invoke(args),
      },
      invocation,
      {
        method: invocation.method,
        contractAddress,
        entityId: input.escrowId,
        userId: input.resolvedBy,
      },
    );
  }

  async getEscrowState(
    escrowId: string,
    contractAddress?: string,
  ): Promise<SorobanEscrowState> {
    const resolvedContract = this.resolveContractAddress(contractAddress);
    return this.client.getEscrowState(resolvedContract, escrowId);
  }

  startPendingEscrowMonitoring(): void {
    if (!this.isConfigured() || this.monitoringStarted) {
      return;
    }

    this.monitoringStarted = true;
    const contractAddress = this.requireContractAddress();

    if (this.client.streamPendingEscrows) {
      Promise.resolve(
        this.client.streamPendingEscrows(contractAddress, (state) =>
          this.applyEscrowStateToBookings(state),
        ),
      )
        .then((stop) => {
          this.stopStream = stop;
          logger.info('Soroban escrow stream monitoring started', {
            contractAddress,
          });
        })
        .catch((error) => {
          logger.warn('Soroban escrow stream unavailable, falling back to polling', {
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          this.startPendingEscrowPolling();
        });

      return;
    }

    this.startPendingEscrowPolling();
  }

  stopPendingEscrowMonitoring(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.stopStream) {
      this.stopStream();
      this.stopStream = null;
    }

    this.monitoringStarted = false;
  }

  private startPendingEscrowPolling(): void {
    if (this.pollTimer) {
      return;
    }

    this.pollTimer = setInterval(() => {
      this.syncPendingEscrows().catch((error) => {
        logger.warn('Soroban escrow polling cycle failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, SOROBAN_POLL_INTERVAL_MS);

    this.syncPendingEscrows().catch((error) => {
      logger.warn('Initial Soroban escrow sync failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    logger.info('Soroban escrow polling started', {
      intervalMs: SOROBAN_POLL_INTERVAL_MS,
    });
  }

  private async syncPendingEscrows(): Promise<void> {
    const { rows } = await pool.query<{
      id: string;
      escrow_id: string;
      escrow_contract_address: string | null;
    }>(
      `SELECT id, escrow_id, escrow_contract_address
       FROM bookings
       WHERE escrow_id IS NOT NULL
         AND status IN ('confirmed', 'completed', 'cancelled')
       LIMIT 200`,
    );

    for (const row of rows) {
      try {
        const state = await this.getEscrowState(
          row.escrow_id,
          row.escrow_contract_address || undefined,
        );
        await this.applyEscrowStateToBookings(state, row.id);
      } catch (error) {
        logger.warn('Failed to sync Soroban escrow state for booking', {
          bookingId: row.id,
          escrowId: row.escrow_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async applyEscrowStateToBookings(
    state: SorobanEscrowState,
    bookingIdHint?: string,
  ): Promise<void> {
    const escrowId = state.escrowId;
    if (!escrowId) {
      return;
    }

    const { rows } = bookingIdHint
      ? await pool.query<{ id: string }>(
          `SELECT id FROM bookings WHERE id = $1 AND escrow_id = $2 LIMIT 1`,
          [bookingIdHint, escrowId],
        )
      : await pool.query<{ id: string }>(
          `SELECT id FROM bookings WHERE escrow_id = $1 LIMIT 1`,
          [escrowId],
        );

    if (!rows.length) {
      return;
    }

    const bookingId = rows[0].id;

    if (state.status === 'released') {
      await pool.query(
        `UPDATE bookings SET payment_status = 'paid', updated_at = NOW() WHERE id = $1`,
        [bookingId],
      );
      return;
    }

    if (state.status === 'refunded') {
      await pool.query(
        `UPDATE bookings SET payment_status = 'refunded', updated_at = NOW() WHERE id = $1`,
        [bookingId],
      );
      return;
    }

    if (state.status === 'disputed') {
      await pool.query(
        `UPDATE bookings SET payment_status = 'failed', updated_at = NOW() WHERE id = $1`,
        [bookingId],
      );
    }
  }

  private getDefaultContractAddress(): string | undefined {
    return (
      process.env.SOROBAN_ESCROW_CONTRACT_ADDRESS ||
      process.env.ESCROW_CONTRACT_ADDRESS ||
      undefined
    );
  }

  private requireContractAddress(): string {
    const contractAddress = this.getDefaultContractAddress();
    if (!contractAddress) {
      throw new Error(
        'SOROBAN_ESCROW_CONTRACT_ADDRESS (or ESCROW_CONTRACT_ADDRESS) is required',
      );
    }
    return contractAddress;
  }

  private resolveContractAddress(contractAddress?: string): string {
    return contractAddress || this.requireContractAddress();
  }
}

function extractEscrowIdFromResult(result: unknown): string | null {
  if (!result || typeof result !== 'object') {
    return null;
  }

  const candidate = result as Record<string, unknown>;
  return (
    asStringId(candidate.escrowId) ||
    asStringId(candidate.escrow_id) ||
    asStringId(candidate.id)
  );
}

function parseEscrowState(
  payload: unknown,
  fallbackEscrowId: string,
  txHash: string | null,
): SorobanEscrowState {
  if (payload && typeof payload === 'object') {
    const candidate = payload as Record<string, unknown>;
    return {
      status:
        asStringId(candidate.status) || asStringId(candidate.state) || 'pending',
      escrowId:
        asStringId(candidate.escrowId) ||
        asStringId(candidate.escrow_id) ||
        asStringId(candidate.id) ||
        fallbackEscrowId,
      txHash,
    };
  }

  return {
    status: asStringId(payload) || 'pending',
    escrowId: fallbackEscrowId,
    txHash,
  };
}

const sorobanEscrowService = new SorobanEscrowServiceImpl(
  new StellarSorobanClient(),
);

export const SorobanEscrowService = {
  setClient: (client: SorobanEscrowClient) =>
    sorobanEscrowService.setClient(client),
  isConfigured: () => sorobanEscrowService.isConfigured(),
  createEscrow: (input: CreateSorobanEscrowInput) =>
    sorobanEscrowService.createEscrow(input),
  releaseFunds: (input: ReleaseSorobanEscrowInput) =>
    sorobanEscrowService.releaseFunds(input),
  refund: (input: RefundSorobanEscrowInput) => sorobanEscrowService.refund(input),
  openDispute: (input: OpenSorobanDisputeInput) =>
    sorobanEscrowService.openDispute(input),
  resolveDispute: (input: ResolveSorobanDisputeInput) =>
    sorobanEscrowService.resolveDispute(input),
  getEscrowState: (escrowId: string, contractAddress?: string) =>
    sorobanEscrowService.getEscrowState(escrowId, contractAddress),
  startPendingEscrowMonitoring: () =>
    sorobanEscrowService.startPendingEscrowMonitoring(),
  stopPendingEscrowMonitoring: () =>
    sorobanEscrowService.stopPendingEscrowMonitoring(),
};
