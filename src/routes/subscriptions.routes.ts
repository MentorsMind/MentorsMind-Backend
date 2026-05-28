import { Router } from "express";
import { SubscriptionController } from "../controllers/subscription.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Subscriptions
 *   description: Subscription tier management
 */

/** GET /api/v1/subscriptions/tiers — public */
router.get("/tiers", SubscriptionController.getTiers);

/** GET /api/v1/subscriptions/current */
router.get("/current", authenticate, SubscriptionController.getCurrent);

/** GET /api/v1/subscriptions */
router.get("/", authenticate, SubscriptionController.list);

/** POST /api/v1/subscriptions */
router.post("/", authenticate, SubscriptionController.subscribe);

/** DELETE /api/v1/subscriptions/:id */
router.delete("/:id", authenticate, SubscriptionController.cancel);

export default router;
