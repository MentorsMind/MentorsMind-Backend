import { Request, Response, NextFunction } from 'express';
import { VestingService } from '../services/vesting.service';
import { logger } from '../utils/logger.utils';
import {
  CreateVestingScheduleRequest,
  VestingType,
  VestingScheduleStatus,
} from '../types/vesting.types';

/**
 * Admin: Create a new vesting schedule
 * POST /api/v1/admin/vesting/schedules
 */
export async function createVestingSchedule(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const input: CreateVestingScheduleRequest = {
      beneficiaryAddress: req.body.beneficiaryAddress,
      totalAmount: req.body.totalAmount,
      cliffDuration: parseInt(req.body.cliffDuration),
      vestingDuration: parseInt(req.body.vestingDuration),
      startTimestamp: req.body.startTimestamp
        ? parseInt(req.body.startTimestamp)
        : undefined,
      vestingType: req.body.vestingType as VestingType,
      notes: req.body.notes,
      beneficiaryUserId: req.body.beneficiaryUserId,
    };

    // Validate required fields
    if (!input.beneficiaryAddress) {
      res.status(400).json({ error: 'beneficiaryAddress is required' });
      return;
    }

    if (!input.totalAmount) {
      res.status(400).json({ error: 'totalAmount is required' });
      return;
    }

    if (isNaN(input.cliffDuration)) {
      res.status(400).json({ error: 'cliffDuration must be a valid number' });
      return;
    }

    if (isNaN(input.vestingDuration)) {
      res.status(400).json({ error: 'vestingDuration must be a valid number' });
      return;
    }

    if (!input.vestingType) {
      res.status(400).json({ error: 'vestingType is required' });
      return;
    }

    const schedule = await VestingService.createSchedule(input, userId);

    logger.info('Vesting schedule created', {
      scheduleId: schedule.scheduleId,
      beneficiary: schedule.beneficiaryAddress,
      createdBy: userId,
    });

    res.status(201).json({
      success: true,
      data: schedule,
    });
  } catch (error) {
    logger.error('Failed to create vesting schedule', {
      error: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof Error) {
      if (
        error.message.includes('Cliff duration') ||
        error.message.includes('Vesting duration')
      ) {
        res.status(422).json({ error: error.message });
        return;
      }
    }

    next(error);
  }
}

/**
 * Admin: Get all vesting schedules
 * GET /api/v1/admin/vesting/schedules
 */
export async function getAllVestingSchedules(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const status = req.query.status as VestingScheduleStatus | undefined;
    const vestingType = req.query.vestingType as VestingType | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

    const result = await VestingService.getAllSchedules({
      status,
      vestingType,
      limit,
      offset,
    });

    res.json({
      success: true,
      data: result.schedules,
      pagination: {
        total: result.total,
        limit,
        offset,
      },
    });
  } catch (error) {
    logger.error('Failed to get all vesting schedules', {
      error: error instanceof Error ? error.message : String(error),
    });
    next(error);
  }
}

/**
 * Admin: Get vesting schedule by ID
 * GET /api/v1/admin/vesting/schedules/:id
 */
export async function getVestingScheduleById(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const scheduleId = parseInt(req.params.id);

    if (isNaN(scheduleId)) {
      res.status(400).json({ error: 'Invalid schedule ID' });
      return;
    }

    const schedule = await VestingService.getScheduleById(scheduleId);

    if (!schedule) {
      res.status(404).json({ error: 'Schedule not found' });
      return;
    }

    res.json({
      success: true,
      data: schedule,
    });
  } catch (error) {
    logger.error('Failed to get vesting schedule', {
      error: error instanceof Error ? error.message : String(error),
    });
    next(error);
  }
}

/**
 * Admin: Revoke vesting schedule
 * DELETE /api/v1/admin/vesting/schedules/:id
 */
export async function revokeVestingSchedule(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const userIdStr = Array.isArray(userId) ? userId[0] : userId;

    const scheduleId = parseInt(req.params.id);

    if (isNaN(scheduleId)) {
      res.status(400).json({ error: 'Invalid schedule ID' });
      return;
    }

    const reason = req.body.reason || 'Revoked by admin';

    await VestingService.revoke(scheduleId, userIdStr, reason);

    logger.info('Vesting schedule revoked', {
      scheduleId,
      revokedBy: userIdStr,
      reason,
    });

    res.json({
      success: true,
      message: 'Vesting schedule revoked successfully',
    });
  } catch (error) {
    logger.error('Failed to revoke vesting schedule', {
      error: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
      return;
    }

    next(error);
  }
}

/**
 * Beneficiary: Get my vesting schedules
 * GET /api/v1/vesting/my-schedules
 */
export async function getMyVestingSchedules(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Get schedules by user ID
    const schedules = await VestingService.getSchedulesByUserId(userId);

    // Also get schedules by wallet address if available
    const walletAddress = req.user?.wallet_address;
    let walletSchedules: any[] = [];

    if (walletAddress) {
      walletSchedules = await VestingService.getSchedulesByBeneficiary(
        walletAddress,
      );
    }

    // Merge and deduplicate schedules
    const allSchedules = [...schedules];
    const scheduleIds = new Set(schedules.map((s) => s.scheduleId));

    for (const schedule of walletSchedules) {
      if (!scheduleIds.has(schedule.scheduleId)) {
        allSchedules.push(schedule);
      }
    }

    res.json({
      success: true,
      data: allSchedules,
    });
  } catch (error) {
    logger.error('Failed to get my vesting schedules', {
      error: error instanceof Error ? error.message : String(error),
    });
    next(error);
  }
}

/**
 * Beneficiary: Claim vesting tokens
 * POST /api/v1/vesting/schedules/:id/claim
 */
export async function claimVesting(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.id;
    const walletAddress = req.user?.wallet_address;

    if (!userId || !walletAddress) {
      res.status(401).json({
        error: 'Unauthorized: wallet address required for claiming',
      });
      return;
    }

    const walletAddressStr = Array.isArray(walletAddress) ? walletAddress[0] : walletAddress;

    const scheduleId = parseInt(req.params.id);

    if (isNaN(scheduleId)) {
      res.status(400).json({ error: 'Invalid schedule ID' });
      return;
    }

    const claim = await VestingService.claim(scheduleId, walletAddressStr);

    logger.info('Vesting tokens claimed', {
      scheduleId,
      beneficiary: walletAddressStr,
      amount: claim.amountClaimed,
    });

    res.json({
      success: true,
      data: claim,
    });
  } catch (error) {
    logger.error('Failed to claim vesting', {
      error: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (
        error.message.includes('Unauthorized') ||
        error.message.includes('not the beneficiary')
      ) {
        res.status(403).json({ error: error.message });
        return;
      }
      if (error.message.includes('Nothing to claim')) {
        res.status(400).json({ error: 'No tokens available to claim yet' });
        return;
      }
    }

    next(error);
  }
}

/**
 * Beneficiary: Get claim history for a schedule
 * GET /api/v1/vesting/schedules/:id/claims
 */
export async function getVestingClaimHistory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const userIdStr = Array.isArray(userId) ? userId[0] : userId;

    const scheduleId = parseInt(req.params.id);

    if (isNaN(scheduleId)) {
      res.status(400).json({ error: 'Invalid schedule ID' });
      return;
    }

    // Verify user has access to this schedule
    const schedule = await VestingService.getScheduleById(scheduleId);

    if (!schedule) {
      res.status(404).json({ error: 'Schedule not found' });
      return;
    }

    // Check if user is the beneficiary or has admin access
    const walletAddress = req.user?.wallet_address;
    const isAdmin = req.user?.role === 'admin' || req.user?.role === 'super_admin';

    if (
      !isAdmin &&
      schedule.beneficiaryUserId !== userId &&
      schedule.beneficiaryAddress !== walletAddress
    ) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const claims = await VestingService.getClaimHistory(scheduleId);

    res.json({
      success: true,
      data: claims,
    });
  } catch (error) {
    logger.error('Failed to get claim history', {
      error: error instanceof Error ? error.message : String(error),
    });
    next(error);
  }
}

/**
 * Get vesting schedule by beneficiary address (public for wallet queries)
 * GET /api/v1/vesting/schedules/by-address/:address
 */
export async function getVestingSchedulesByAddress(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const address = req.params.address;

    if (!address) {
      res.status(400).json({ error: 'Address is required' });
      return;
    }

    const addressStr = Array.isArray(address) ? address[0] : address;

    const schedules = await VestingService.getSchedulesByBeneficiary(addressStr);

    res.json({
      success: true,
      data: schedules,
    });
  } catch (error) {
    logger.error('Failed to get schedules by address', {
      error: error instanceof Error ? error.message : String(error),
    });
    next(error);
  }
}
