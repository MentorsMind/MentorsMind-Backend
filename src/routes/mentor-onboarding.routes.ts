import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/admin-auth.middleware';
import { MentorOnboardingController } from '../controllers/mentor-onboarding.controller';

const router = Router();

router.use(authenticate);

router.post('/initialize', MentorOnboardingController.initialize);
router.get('/progress', MentorOnboardingController.progress);
router.post('/steps/:stepId/complete', MentorOnboardingController.completeStep);
router.post('/pause', MentorOnboardingController.pause);
router.post('/resume', MentorOnboardingController.resume);
router.get('/wizard-steps', MentorOnboardingController.wizardSteps);
router.get('/profile-score', MentorOnboardingController.profileScore);
router.post('/profile-score/refresh', MentorOnboardingController.refreshProfileScore);
router.get('/suggestions', MentorOnboardingController.suggestions);
router.get('/email-sequences', MentorOnboardingController.emailSequences);
router.get('/checklist', MentorOnboardingController.checklist);
router.post('/checklist/:itemKey/complete', MentorOnboardingController.completeChecklistItem);
router.get('/analytics', MentorOnboardingController.analytics);

router.get('/admin/analytics', requireAdmin, MentorOnboardingController.adminAnalytics);

export default router;
