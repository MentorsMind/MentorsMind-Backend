import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { mobileApiMiddleware } from "../middleware/mobile-api.middleware";
import { MobileController } from "../controllers/mobile/mobile.controller";

const router = Router();

router.use(mobileApiMiddleware);

router.get("/sync-status", authenticate, MobileController.getSyncStatus);
router.post("/sync", authenticate, MobileController.sync);
router.get("/snapshot", authenticate, MobileController.getOptimizedSnapshot);
router.post("/push/register", authenticate, MobileController.registerPushToken);

export default router;
