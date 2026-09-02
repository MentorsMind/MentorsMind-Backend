import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/admin-auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { MentorOnboardingController } from '../controllers/mentor-onboarding.controller';
import {
  completeOnboardingStepFlowSchema,
  pauseOnboardingSchema,
  completeChecklistItemSchema,
} from '../validators/schemas/mentor-onboarding-flow.schemas';

const router = Router();

router.use(authenticate);

router.post('/initialize', MentorOnboardingController.initialize);
router.get('/progress', MentorOnboardingController.progress);
router.post(
  '/steps/:stepId/complete',
  validate(completeOnboardingStepFlowSchema),
  MentorOnboardingController.completeStep,
);
router.post('/pause', validate(pauseOnboardingSchema), MentorOnboardingController.pause);
router.post('/resume', MentorOnboardingController.resume);
router.get('/wizard-steps', MentorOnboardingController.wizardSteps);
router.get('/profile-score', MentorOnboardingController.profileScore);
router.post('/profile-score/refresh', MentorOnboardingController.refreshProfileScore);
router.get('/suggestions', MentorOnboardingController.suggestions);
router.get('/email-sequences', MentorOnboardingController.emailSequences);
router.get('/checklist', MentorOnboardingController.checklist);
router.post(
  '/checklist/:itemKey/complete',
  validate(completeChecklistItemSchema),
  MentorOnboardingController.completeChecklistItem,
);
router.get('/analytics', MentorOnboardingController.analytics);
router.get('/badges', MentorOnboardingController.badges);

router.get('/admin/analytics', requireAdmin, MentorOnboardingController.adminAnalytics);
router.get('/admin/funnel-analytics', requireAdmin, MentorOnboardingController.adminFunnelAnalytics);
router.post('/admin/trigger-nudge', requireAdmin, MentorOnboardingController.triggerNudge);

export default router;
