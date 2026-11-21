import * as StellarSdk from '@stellar/stellar-sdk';
import pool from '../config/database';
import { env } from '../config/env';
import { logger } from '../utils/logger.utils';
import {
  executeSorobanInvocation,
  asStringId,
} from '../utils/soroban.utils';
import {
  VestingSchedule,
  CreateVestingScheduleParams,
  VestingContractMethod,
  VestingScheduleModel,
  VestingScheduleResponse,
  VestingClaimResponse,
  VestingScheduleStatus,
  VestingType,
  VestingUtils,
  VESTING_CONSTANTS,
  CreateVestingScheduleRequest,
} from '../types/vesting.types';

interface SorobanContractInvocation {
  contractAddress: string;
  method: VestingContractMethod;
  args: unknown[];
}

export interface SorobanInvocationResult {
  txHash: string | null;
  result: unknown;
}

export interface SorobanVestingClient {
  simulate(params: SorobanContractInvocation): Promise<void>;
  invoke(params: SorobanContractInvocation): Promise<SorobanInvocationResult>;
}

/**
 * Stellar Soroban client for vesting contract interactions
 */
class StellarSorobanVestingClient implements SorobanVestingClient {
  private readonly rpcServer: any;
  private readonly keypair: any;
  private readonly networkPassphrase: string;

  constructor() {
    const sdkAny = StellarSdk as any;
    const serverUrl = env.SOROBAN_RPC_URL;

    const RpcServerCtor = sdkAny.SorobanRpc?.Server || sdkAny.rpc?.Server;
    this.rpcServer = RpcServerCtor ? new RpcServerCtor(serverUrl) : null;

    this.keypair = env.PLATFORM_SECRET_KEY
      ? sdkAny.Keypair.fromSecret(env.PLATFORM_SECRET_KEY)
      : null;

    this.networkPassphrase =
      env.STELLAR_NETWORK === 'mainnet'
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

  async invoke(
    params: SorobanContractInvocation,
  ): Promise<SorobanInvocationResult> {
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

  private async buildContractTransaction(
    params: SorobanContractInvocation,
  ): Promise<any> {
    const sdkAny = StellarSdk as any;

    if (!this.rpcServer) {
      throw new Error(
        'Soroban RPC client is not available in @stellar/stellar-sdk',
      );
    }

    const sourcePublicKey =
      this.keypair?.publicKey?.() || env.PLATFORM_PUBLIC_KEY;

    if (!sourcePublicKey) {
      throw new Error(
        'PLATFORM_PUBLIC_KEY or PLATFORM_SECRET_KEY is required for Soroban calls',
      );
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

/**
 * Vesting Service Implementation
 */
class VestingServiceImpl {
  constructor(private client: SorobanVestingClient) {}

  setClient(client: SorobanVestingClient): void {
    this.client = client;
  }

  isConfigured(): boolean {
    return Boolean(this.getDefaultContractAddress());
  }

  /**
   * Create a new vesting schedule
   */
  async createSchedule(
    input: CreateVestingScheduleRequest,
    createdBy: string,
  ): Promise<VestingScheduleResponse> {
    const contractAddress = this.requireContractAddress();

    // Validate durations
    const validation = VestingUtils.validateDurations(
      input.cliffDuration,
      input.vestingDuration,
    );
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Convert amount to stroops if needed (assume input is in XLM if < 1000, otherwise stroops)
    const totalAmountStroops =
      parseFloat(input.totalAmount) < 1000
        ? VestingUtils.xlmToStroops(parseFloat(input.totalAmount))
        : BigInt(input.totalAmount);

    const params: CreateVestingScheduleParams = {
      beneficiary: input.beneficiaryAddress,
      totalAmount: totalAmountStroops,
      cliffSeconds: input.cliffDuration,
      vestingSeconds: input.vestingDuration,
      start: input.startTimestamp || 0,
    };

    const invocation = {
      contractAddress,
      method: 'create_schedule' as const,
      args: [
        params.beneficiary,
        params.totalAmount.toString(),
        params.cliffSeconds,
        params.vestingSeconds,
        params.start,
      ],
    };

    logger.info('Creating vesting schedule on Soroban', {
      beneficiary: params.beneficiary,
      totalAmount: params.totalAmount.toString(),
      cliffSeconds: params.cliffSeconds,
      vestingSeconds: params.vestingSeconds,
    });

    const tx = await executeSorobanInvocation(
      {
        simulate: (args) => this.client.simulate(args),
        submit: (args) => this.client.invoke(args),
      },
      invocation,
      {
        method: invocation.method,
        contractAddress,
        userId: createdBy,
      },
    );

    // Extract schedule ID from transaction result
    const scheduleId = this.extractScheduleIdFromResult(tx.result);
    if (!scheduleId) {
      throw new Error(
        'Failed to extract schedule ID from contract response',
      );
    }

    // Calculate timestamps
    const startTimestamp = params.start || Math.floor(Date.now() / 1000);
    const cliffEnd = startTimestamp + params.cliffSeconds;
    const vestingEnd = startTimestamp + params.cliffSeconds + params.vestingSeconds;

    // Store in PostgreSQL mirror table
    const { rows } = await pool.query<VestingScheduleModel>(
      `INSERT INTO vesting_schedules (
        schedule_id,
        beneficiary_address,
        beneficiary_user_id,
        total_amount,
        claimed_amount,
        cliff_end_timestamp,
        vesting_end_timestamp,
        start_timestamp,
        contract_address,
        status,
        vesting_type,
        notes,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        scheduleId,
        input.beneficiaryAddress,
        input.beneficiaryUserId || null,
        totalAmountStroops.toString(),
        '0',
        cliffEnd,
        vestingEnd,
        startTimestamp,
        contractAddress,
        'active',
        input.vestingType,
        input.notes || null,
        createdBy,
      ],
    );

    logger.info('Vesting schedule created and stored in DB', {
      scheduleId,
      txHash: tx.txHash,
    });

    return this.mapToResponse(rows[0]);
  }

  /**
   * Claim tokens from a vesting schedule
   */
  async claim(
    scheduleId: number,
    beneficiaryAddress: string,
  ): Promise<VestingClaimResponse> {
    const contractAddress = this.requireContractAddress();

    // Get schedule from DB to verify beneficiary
    const schedule = await this.getScheduleById(scheduleId);
    if (!schedule) {
      throw new Error(`Schedule ${scheduleId} not found`);
    }

    if (schedule.beneficiaryAddress !== beneficiaryAddress) {
      throw new Error('Unauthorized: not the beneficiary of this schedule');
    }

    if (schedule.status !== 'active') {
      throw new Error(`Cannot claim from ${schedule.status} schedule`);
    }

    const invocation = {
      contractAddress,
      method: 'claim' as const,
      args: [scheduleId],
    };

    logger.info('Claiming vesting tokens', {
      scheduleId,
      beneficiaryAddress,
    });

    const tx = await executeSorobanInvocation(
      {
        simulate: (args) => this.client.simulate(args),
        submit: (args) => this.client.invoke(args),
      },
      invocation,
      {
        method: invocation.method,
        contractAddress,
        entityId: String(scheduleId),
        userId: beneficiaryAddress,
      },
    );

    // Sync the schedule to get updated claimed amount
    await this.syncSchedule(scheduleId);

    // Get updated schedule
    const updatedSchedule = await this.getScheduleById(scheduleId);
    const amountClaimed = BigInt(updatedSchedule!.claimedAmount) - BigInt(schedule.claimedAmount);

    // Record the claim in audit trail
    const { rows } = await pool.query<{
      id: number;
      claimed_at: Date;
    }>(
      `INSERT INTO vesting_claims (
        schedule_id,
        amount_claimed,
        tx_hash,
        beneficiary_address
      ) VALUES ($1, $2, $3, $4)
      RETURNING id, claimed_at`,
      [
        scheduleId,
        amountClaimed.toString(),
        tx.txHash,
        beneficiaryAddress,
      ],
    );

    logger.info('Vesting tokens claimed successfully', {
      scheduleId,
      amountClaimed: amountClaimed.toString(),
      txHash: tx.txHash,
    });

    return {
      scheduleId,
      amountClaimed: amountClaimed.toString(),
      claimedAt: rows[0].claimed_at,
      txHash: tx.txHash || undefined,
      beneficiaryAddress,
    };
  }

  /**
   * Revoke a vesting schedule (admin only)
   */
  async revoke(
    scheduleId: number,
    revokedBy: string,
    reason?: string,
  ): Promise<void> {
    const contractAddress = this.requireContractAddress();

    const schedule = await this.getScheduleById(scheduleId);
    if (!schedule) {
      throw new Error(`Schedule ${scheduleId} not found`);
    }

    if (schedule.status !== 'active') {
      throw new Error(`Cannot revoke ${schedule.status} schedule`);
    }

    const invocation = {
      contractAddress,
      method: 'revoke' as const,
      args: [scheduleId],
    };

    logger.info('Revoking vesting schedule', {
      scheduleId,
      revokedBy,
      reason,
    });

    await executeSorobanInvocation(
      {
        simulate: (args) => this.client.simulate(args),
        submit: (args) => this.client.invoke(args),
      },
      invocation,
      {
        method: invocation.method,
        contractAddress,
        entityId: String(scheduleId),
        userId: revokedBy,
      },
    );

    // Update status in DB
    await pool.query(
      `UPDATE vesting_schedules
       SET status = 'revoked',
           revoked_by = $1,
           revoked_at = NOW(),
           notes = CASE
             WHEN notes IS NULL THEN $2
             ELSE notes || E'\n\nRevoked: ' || $2
           END,
           updated_at = NOW()
       WHERE schedule_id = $3`,
      [revokedBy, reason || 'No reason provided', scheduleId],
    );

    logger.info('Vesting schedule revoked', { scheduleId });
  }

  /**
   * Get claimable amount for a schedule (from contract)
   */
  async getClaimableAmount(scheduleId: number): Promise<bigint> {
    const contractAddress = this.requireContractAddress();

    const invocation = {
      contractAddress,
      method: 'claimable_amount' as const,
      args: [scheduleId],
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
        entityId: String(scheduleId),
      },
    );

    return this.extractBigIntFromResult(tx.result);
  }

  /**
   * Get schedule details from contract
   */
  async getScheduleFromContract(
    scheduleId: number,
  ): Promise<VestingSchedule> {
    const contractAddress = this.requireContractAddress();

    const invocation = {
      contractAddress,
      method: 'get_schedule' as const,
      args: [scheduleId],
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
        entityId: String(scheduleId),
      },
    );

    return this.parseVestingSchedule(tx.result);
  }

  /**
   * Get schedule by ID from database
   */
  async getScheduleById(
    scheduleId: number,
  ): Promise<VestingScheduleResponse | null> {
    const { rows } = await pool.query<VestingScheduleModel>(
      `SELECT * FROM vesting_schedules WHERE schedule_id = $1`,
      [scheduleId],
    );

    if (rows.length === 0) {
      return null;
    }

    return this.mapToResponse(rows[0]);
  }

  /**
   * Get all schedules for a beneficiary
   */
  async getSchedulesByBeneficiary(
    beneficiaryAddress: string,
  ): Promise<VestingScheduleResponse[]> {
    const { rows } = await pool.query<VestingScheduleModel>(
      `SELECT * FROM vesting_schedules
       WHERE beneficiary_address = $1
       ORDER BY created_at DESC`,
      [beneficiaryAddress],
    );

    return rows.map((row) => this.mapToResponse(row));
  }

  /**
   * Get all schedules for a user ID
   */
  async getSchedulesByUserId(
    userId: string,
  ): Promise<VestingScheduleResponse[]> {
    const { rows } = await pool.query<VestingScheduleModel>(
      `SELECT * FROM vesting_schedules
       WHERE beneficiary_user_id = $1
       ORDER BY created_at DESC`,
      [userId],
    );

    return rows.map((row) => this.mapToResponse(row));
  }

  /**
   * Get all schedules (admin)
   */
  async getAllSchedules(
    filters?: {
      status?: VestingScheduleStatus;
      vestingType?: VestingType;
      limit?: number;
      offset?: number;
    },
  ): Promise<{ schedules: VestingScheduleResponse[]; total: number }> {
    let whereClause = '';
    const params: any[] = [];
    let paramCount = 1;

    if (filters?.status) {
      whereClause += ` WHERE status = $${paramCount}`;
      params.push(filters.status);
      paramCount++;
    }

    if (filters?.vestingType) {
      whereClause += whereClause ? ' AND' : ' WHERE';
      whereClause += ` vesting_type = $${paramCount}`;
      params.push(filters.vestingType);
      paramCount++;
    }

    const { rows: countRows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM vesting_schedules${whereClause}`,
      params,
    );

    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;

    const { rows } = await pool.query<VestingScheduleModel>(
      `SELECT * FROM vesting_schedules${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      [...params, limit, offset],
    );

    return {
      schedules: rows.map((row) => this.mapToResponse(row)),
      total: parseInt(countRows[0].count),
    };
  }

  /**
   * Get claim history for a schedule
   */
  async getClaimHistory(
    scheduleId: number,
  ): Promise<VestingClaimResponse[]> {
    const { rows } = await pool.query(
      `SELECT * FROM vesting_claims
       WHERE schedule_id = $1
       ORDER BY claimed_at DESC`,
      [scheduleId],
    );

    return rows.map((row) => ({
      scheduleId: row.schedule_id,
      amountClaimed: row.amount_claimed,
      claimedAt: row.claimed_at,
      txHash: row.tx_hash || undefined,
      beneficiaryAddress: row.beneficiary_address,
    }));
  }

  /**
   * Sync schedule with on-chain data
   */
  async syncSchedule(scheduleId: number): Promise<void> {
    try {
      const onChainSchedule = await this.getScheduleFromContract(scheduleId);

      await pool.query(
        `UPDATE vesting_schedules
         SET claimed_amount = $1,
             last_synced_at = NOW()
         WHERE schedule_id = $2`,
        [onChainSchedule.claimed.toString(), scheduleId],
      );

      logger.debug('Schedule synced', { scheduleId });
    } catch (error) {
      logger.warn('Failed to sync schedule', {
        scheduleId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Sync all active schedules (used by worker)
   */
  async syncAllSchedules(): Promise<{
    synced: number;
    failed: number;
  }> {
    const { rows } = await pool.query<{ schedule_id: number }>(
      `SELECT schedule_id FROM vesting_schedules
       WHERE status = 'active'
       ORDER BY last_synced_at ASC
       LIMIT 100`,
    );

    let synced = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        await this.syncSchedule(row.schedule_id);
        synced++;
      } catch (error) {
        failed++;
        logger.warn('Failed to sync schedule in batch', {
          scheduleId: row.schedule_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { synced, failed };
  }

  /**
   * Map database model to API response
   */
  private mapToResponse(
    model: VestingScheduleModel,
  ): VestingScheduleResponse {
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const totalAmount = BigInt(model.total_amount);
    const claimedAmount = BigInt(model.claimed_amount);

    // Calculate claimable amount
    const schedule: VestingSchedule = {
      beneficiary: model.beneficiary_address,
      total: totalAmount,
      claimed: claimedAmount,
      cliff_end: model.cliff_end_timestamp,
      vesting_end: model.vesting_end_timestamp,
      start: model.start_timestamp,
    };

    const claimableNow = VestingUtils.calculateClaimableAmount(
      schedule,
      currentTimestamp,
    );
    const vestingPercent = VestingUtils.calculateVestingPercent(
      schedule,
      currentTimestamp,
    );

    return {
      scheduleId: model.schedule_id,
      beneficiaryAddress: model.beneficiary_address,
      beneficiaryUserId: model.beneficiary_user_id || undefined,
      totalAmount: model.total_amount,
      claimedAmount: model.claimed_amount,
      cliffEnd: model.cliff_end_timestamp,
      vestingEnd: model.vesting_end_timestamp,
      start: model.start_timestamp,
      contractAddress: model.contract_address,
      status: model.status,
      vestingType: model.vesting_type,
      notes: model.notes || undefined,
      claimableNow: claimableNow.toString(),
      claimablePercent: vestingPercent,
      isCliffPassed: currentTimestamp >= model.cliff_end_timestamp + VESTING_CONSTANTS.TIMESTAMP_TOLERANCE_SECS,
      isFullyVested: currentTimestamp >= model.vesting_end_timestamp,
      createdAt: model.created_at,
      updatedAt: model.updated_at,
      lastSyncedAt: model.last_synced_at,
    };
  }

  private extractScheduleIdFromResult(result: unknown): number | null {
    if (typeof result === 'number') {
      return result;
    }

    if (result && typeof result === 'object') {
      const candidate = result as Record<string, unknown>;
      const id =
        candidate.scheduleId ||
        candidate.schedule_id ||
        candidate.id;
      if (typeof id === 'number') {
        return id;
      }
      if (typeof id === 'string') {
        return parseInt(id);
      }
    }

    return null;
  }

  private extractBigIntFromResult(result: unknown): bigint {
    if (typeof result === 'bigint') {
      return result;
    }
    if (typeof result === 'number') {
      return BigInt(result);
    }
    if (typeof result === 'string') {
      return BigInt(result);
    }
    return 0n;
  }

  private parseVestingSchedule(result: unknown): VestingSchedule {
    if (!result || typeof result !== 'object') {
      throw new Error('Invalid schedule data from contract');
    }

    const data = result as any;
    return {
      beneficiary: String(data.beneficiary),
      total: BigInt(data.total),
      claimed: BigInt(data.claimed),
      cliff_end: Number(data.cliff_end),
      vesting_end: Number(data.vesting_end),
      start: Number(data.start),
    };
  }

  private getDefaultContractAddress(): string | undefined {
    return (
      env.SOROBAN_VESTING_CONTRACT_ADDRESS ||
      env.VESTING_CONTRACT_ADDRESS ||
      undefined
    );
  }

  private requireContractAddress(): string {
    const contractAddress = this.getDefaultContractAddress();
    if (!contractAddress) {
      throw new Error(
        'SOROBAN_VESTING_CONTRACT_ADDRESS (or VESTING_CONTRACT_ADDRESS) is required',
      );
    }
    return contractAddress;
  }
}

const vestingService = new VestingServiceImpl(
  new StellarSorobanVestingClient(),
);

export const VestingService = {
  setClient: (client: SorobanVestingClient) =>
    vestingService.setClient(client),
  isConfigured: () => vestingService.isConfigured(),
  createSchedule: (input: CreateVestingScheduleRequest, createdBy: string) =>
    vestingService.createSchedule(input, createdBy),
  claim: (scheduleId: number, beneficiaryAddress: string) =>
    vestingService.claim(scheduleId, beneficiaryAddress),
  revoke: (scheduleId: number, revokedBy: string, reason?: string) =>
    vestingService.revoke(scheduleId, revokedBy, reason),
  getClaimableAmount: (scheduleId: number) =>
    vestingService.getClaimableAmount(scheduleId),
  getScheduleById: (scheduleId: number) =>
    vestingService.getScheduleById(scheduleId),
  getSchedulesByBeneficiary: (beneficiaryAddress: string) =>
    vestingService.getSchedulesByBeneficiary(beneficiaryAddress),
  getSchedulesByUserId: (userId: string) =>
    vestingService.getSchedulesByUserId(userId),
  getAllSchedules: (filters?: {
    status?: VestingScheduleStatus;
    vestingType?: VestingType;
    limit?: number;
    offset?: number;
  }) => vestingService.getAllSchedules(filters),
  getClaimHistory: (scheduleId: number) =>
    vestingService.getClaimHistory(scheduleId),
  syncSchedule: (scheduleId: number) =>
    vestingService.syncSchedule(scheduleId),
  syncAllSchedules: () => vestingService.syncAllSchedules(),
};
