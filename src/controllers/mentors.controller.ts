// @ts-nocheck
/**
 * Mentors Controller
 */

import { Response } from 'express';
import { AuthenticatedRequest } from '../types/api.types';
import { MentorsService } from '../services/mentors.service';
import { ResponseUtil } from '../utils/response.utils';

export const MentorsController = {
  /** POST /mentors */
  async createProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    const existing = await MentorsService.findById(req.user!.id);
    if (existing) {
      ResponseUtil.conflict(res, 'Mentor profile already exists');
      return;
    }
    const mentor = await MentorsService.createProfile(req.user!.id, req.body);
    if (!mentor) {
      ResponseUtil.notFound(res, 'User not found');
      return;
    }
    ResponseUtil.created(res, mentor, 'Mentor profile created successfully');
  },

  /** GET /mentors/:id */
  async getProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    const mentor = await MentorsService.findById(req.params.id);
    if (!mentor) {
      ResponseUtil.notFound(res, 'Mentor not found');
      return;
    }
    ResponseUtil.success(res, mentor, 'Mentor profile retrieved successfully');
  },

  /** PUT /mentors/:id */
  async updateProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    const updated = await MentorsService.update(req.params.id, req.body);
    if (!updated) {
      ResponseUtil.notFound(res, 'Mentor not found');
      return;
    }
    ResponseUtil.success(res, updated, 'Mentor profile updated successfully');
  },

  /** GET /mentors */
  async listMentors(req: AuthenticatedRequest, res: Response): Promise<void> {
    const result = await MentorsService.list(req.query as any);
    ResponseUtil.success(
      res,
      {
        data: result.mentors,
        next_cursor: result.next_cursor,
        has_more: result.has_more,
        total: result.total,
      },
      'Mentors retrieved successfully',
    );
  },

  /** POST /mentors/:id/availability */
  async setAvailability(req: AuthenticatedRequest, res: Response): Promise<void> {
    const updated = await MentorsService.setAvailability(req.params.id, req.body);
    if (!updated) {
      ResponseUtil.notFound(res, 'Mentor not found');
      return;
    }
    ResponseUtil.success(
      res,
      { availability_schedule: updated.availability_schedule, is_available: updated.is_available },
      'Availability updated successfully',
    );
  },

  /** GET /mentors/:id/availability */
  async getAvailability(req: AuthenticatedRequest, res: Response): Promise<void> {
    const availability = await MentorsService.getAvailability(req.params.id);
    if (!availability) {
      ResponseUtil.notFound(res, 'Mentor not found');
      return;
    }
    ResponseUtil.success(res, availability, 'Availability retrieved successfully');
  },

  /** PUT /mentors/:id/pricing */
  async updatePricing(req: AuthenticatedRequest, res: Response): Promise<void> {
    const updated = await MentorsService.updatePricing(req.params.id, req.body);
    if (!updated) {
      ResponseUtil.notFound(res, 'Mentor not found');
      return;
    }
    ResponseUtil.success(
      res,
      { hourlyRate: updated.hourly_rate },
      'Pricing updated successfully',
    );
  },

  /** GET /mentors/:id/sessions */
  async getSessions(req: AuthenticatedRequest, res: Response): Promise<void> {
    // This endpoint also needs to be migrated to cursor pagination if we want consistency.
    // However, the Service.getSessions hasn't been updated yet. 
    // I'll update the Service.getSessions first.
    const result = await MentorsService.getSessions(req.params.id, req.query as any);
    ResponseUtil.success(res, {
      data: result.sessions,
      next_cursor: result.next_cursor,
      has_more: result.has_more,
      total: result.total,
    }, 'Sessions retrieved successfully');
  },

  /** GET /mentors/:id/earnings */
  async getEarnings(req: AuthenticatedRequest, res: Response): Promise<void> {
    const earnings = await MentorsService.getEarnings(req.params.id, req.query as any);
    ResponseUtil.success(res, earnings, 'Earnings retrieved successfully');
  },

  /** POST /mentors/:id/verify */
  async submitVerification(req: AuthenticatedRequest, res: Response): Promise<void> {
    const result = await MentorsService.submitVerification(req.params.id, req.body);
    ResponseUtil.success(res, result, result.message);
  },
};
