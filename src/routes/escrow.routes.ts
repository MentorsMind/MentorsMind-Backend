import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/rbac.middleware";
import { idempotency } from "../middleware/idempotency.middleware";
import { EscrowController } from "../controllers/escrow.controller";

const router = Router();

// All escrow routes require authentication
router.use(authenticate);

// POST /escrow — create escrow (learner only)
router.post("/", requireRole("user"), idempotency, EscrowController.createEscrow);

// GET /escrow — list user's escrows
router.get("/", EscrowController.listEscrows);

// GET /escrow/:id — get escrow details
router.get("/:id", EscrowController.getEscrow);

// GET /escrow/:id/status — get escrow status
router.get("/:id/status", EscrowController.getEscrowStatus);

// POST /escrow/:id/release — release funds to mentor (learner or admin)
router.post("/:id/release", idempotency, EscrowController.releaseEscrow);

// POST /escrow/:id/refund — refund to learner (admin only)
router.post("/:id/refund", requireRole("admin"), idempotency, EscrowController.refundEscrow);

// POST /escrow/:id/dispute — open dispute (learner or mentor)
router.post("/:id/dispute", idempotency, EscrowController.openDispute);

// POST /escrow/:id/resolve — resolve dispute (admin only)
router.post("/:id/resolve", requireRole("admin"), idempotency, EscrowController.resolveDispute);

export default router;
