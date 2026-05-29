import { Router } from "express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { authenticate } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/admin-auth.middleware";
import { emailQueue } from "../queues/email.queue";
import { paymentPollQueue } from "../queues/payment-poll.queue";
import { escrowReleaseQueue } from "../queues/escrow-release.queue";
import { reportQueue } from "../queues/report.queue";
import { exportQueue } from "../queues/export.queue";
import { stellarTxQueue } from "../queues/stellar-tx.queue";
import { escrowCheckQueue } from "../queues/escrow-check.queue";
import { notificationQueue } from "../queues/notification.queue";

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/api/v1/admin/jobs");

createBullBoard({
  queues: [
    new BullMQAdapter(emailQueue),
    new BullMQAdapter(paymentPollQueue),
    new BullMQAdapter(escrowReleaseQueue),
    new BullMQAdapter(reportQueue),
    new BullMQAdapter(exportQueue),
    new BullMQAdapter(stellarTxQueue),
    new BullMQAdapter(escrowCheckQueue),
    new BullMQAdapter(notificationQueue),
  ],
  serverAdapter,
});

const router = Router();

// Protect Bull Board behind admin auth
router.use(authenticate, requireAdmin, serverAdapter.getRouter());

export default router;
