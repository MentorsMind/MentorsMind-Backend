import { Request, Response } from "express";
import { WalletReconciliationService } from "../services/wallet-reconciliation.service";
import { routeParam } from "../utils/route-params.utils";

export class WalletReconciliationController {
  /**
   * POST /api/v1/admin/wallets/:id/sync
   * On-demand reconciliation of a single wallet against the Stellar network.
   * Typically completes in well under 5 seconds (one Horizon account lookup
   * plus a handful of DB operations).
   */
  static async syncWallet(req: Request, res: Response): Promise<void> {
    const id = routeParam(req.params.id);
    if (!id) {
      res.status(400).json({ success: false, message: "Wallet id is required" });
      return;
    }

    const result = await WalletReconciliationService.syncWallet(id);

    if (result.status === "error") {
      res.status(502).json({ success: false, data: result });
      return;
    }
    if (result.status === "no_wallet") {
      res.status(404).json({ success: false, message: "Wallet not found", data: result });
      return;
    }

    res.status(200).json({ success: true, data: result });
  }
}
