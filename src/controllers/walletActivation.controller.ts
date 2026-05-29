import { Response } from "express";
import { AuthenticatedRequest } from "../types";
import { StellarAccountService } from "../services/stellarAccount.service";
import { ResponseUtil } from "../utils/response.utils";

export const WalletActivationController = {
  async activate(req: AuthenticatedRequest, res: Response) {
    const userId = req.user!.id;

    const result = await StellarAccountService.activateExistingWallet(userId);

    return ResponseUtil.success(res, result, "Wallet activated successfully");
  },
};
