import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { loadProfile } from '../middleware/authorization.middleware.js';

const router = Router();

/*
 * Devuelve identidad + perfil. El perfil (user_profiles) se
 * carga siempre: si el usuario no tiene perfil o está inactivo,
 * loadProfile responde 403 y el frontend no puede operar.
 */
router.get('/me', requireAuth, loadProfile, (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email ?? null,
    profile: {
      id: req.profile.id,
      client_id: req.profile.client_id,
      role: req.profile.role,
      display_name: req.profile.display_name,
      active: req.profile.active,
    },
  });
});

export default router;
