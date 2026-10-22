import { Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { UsersService } from "../services/users.service";
import { ResponseUtil } from "../utils/response.utils";

function getAuthenticatedUserId(req: AuthenticatedRequest): string {
  return (req.user as any)?.id ?? (req.user as any)?.userId;
}

export const UserStatsController = {
  /** GET /users/me/stats */
  async getMeStats(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = getAuthenticatedUserId(req);
    const stats = await UsersService.getUserStats(userId);
    ResponseUtil.success(res, stats, "User stats retrieved successfully");
  },
};
