import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { DynamicPricingController } from '../controllers/dynamic-pricing.controller';

const router = Router();

router.use(authenticate);

router.get('/market-demand', DynamicPricingController.getMarketDemand);
router.get('/benchmarks', DynamicPricingController.getBenchmarks);
router.get('/recommendation', DynamicPricingController.getRecommendation);
router.post('/recommendation/apply', DynamicPricingController.applyRecommendation);
router.get('/experiments', DynamicPricingController.getExperiments);
router.post('/experiments', DynamicPricingController.createExperiment);
router.patch('/experiments/:id/status', DynamicPricingController.updateExperimentStatus);
router.get('/dashboard', DynamicPricingController.getDashboard);

export default router;
