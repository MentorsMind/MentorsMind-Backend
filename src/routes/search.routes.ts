import { Router } from 'express';
import { findMentors, autocomplete, getSimilarMentors, getPopularSearches } from '../controllers/search.controller';

const router = Router();

router.get('/mentors', findMentors);
router.get('/autocomplete/:query', autocomplete);
router.get('/similar/:mentorId', getSimilarMentors);
router.get('/popular', getPopularSearches);

export default router;
