import { Response } from "express";
import { StellarFeesService } from "../services/stellarFees.service";
import { ResponseUtil } from "../utils/response.utils";
import { AuthenticatedRequest } from "../types/api.types";

export const FeeEstimateController = {
  async getFeeEstimate(req: AuthenticatedRequest, res: Response) {
    const operations = Math.max(1, Number(req.query.operations) || 1);

    const fee = await StellarFeesService.getFeeEstimate(operations);

    ResponseUtil.success(res, fee, "Fee estimate fetched successfully");
  },
};
