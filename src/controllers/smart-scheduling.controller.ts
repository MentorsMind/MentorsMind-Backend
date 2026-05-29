import { Request, Response } from "express";
import { SmartSchedulingService } from "../services/smart-scheduling.service";
import { ResponseUtil } from "../utils/response.utils";
import { asyncHandler } from "../utils/asyncHandler.utils";

export const SmartSchedulingController = {
  /**
   * Suggest optimal booking times between a mentor and mentee
   * GET /api/v1/bookings/suggest-times
   */
  suggestOptimalTimes: asyncHandler(async (req: Request, res: Response) => {
    const { mentorId, durationMinutes, startDate, endDate } = req.query;
    const menteeId = (req as any).user?.id || (req as any).user?.userId;

    if (!menteeId) {
      return ResponseUtil.unauthorized(res, "Authentication required");
    }

    if (!mentorId || typeof mentorId !== "string") {
      return ResponseUtil.error(res, "Mentor ID is required", 400);
    }

    const duration = durationMinutes
      ? parseInt(durationMinutes as string, 10)
      : 60;
    const start = startDate ? new Date(startDate as string) : undefined;
    const end = endDate ? new Date(endDate as string) : undefined;

    const suggestions = await SmartSchedulingService.suggestOptimalTimes(
      mentorId,
      menteeId,
      duration,
      start,
      end,
    );

    return ResponseUtil.success(
      res,
      { suggestions },
      "Optimal booking times suggested successfully",
    );
  }),

  /**
   * Suggest rescheduling times for an existing booking
   * GET /api/v1/bookings/:id/suggest-reschedule
   */
  suggestReschedule: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user?.id || (req as any).user?.userId;

    if (!userId) {
      return ResponseUtil.unauthorized(res, "Authentication required");
    }

    if (!id || typeof id !== "string") {
      return ResponseUtil.error(res, "Booking ID is required in URL path", 400);
    }

    const suggestions = await SmartSchedulingService.suggestReschedule(
      id,
      userId,
    );

    return ResponseUtil.success(
      res,
      { suggestions },
      "Optimal rescheduling times suggested successfully",
    );
  }),
};

export default SmartSchedulingController;
