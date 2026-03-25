import { Router } from 'express';
import { findMentors } from '../controllers/search.controller';

const router = Router();

router.get('/mentors', findMentors);

export default router;
