import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/me', requireAuth, (req, res) => {
  res.json({ id: req.user.id, email: req.user.email ?? null });
});

export default router;
