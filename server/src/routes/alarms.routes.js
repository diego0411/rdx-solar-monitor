import { Router } from 'express';
import { getAlarm, getSummary, listAlarms } from '../controllers/alarms.controller.js';
import { requireModuleAccess } from '../middleware/authorization.middleware.js';

/*
 * API normalizada de alarmas sobre public.alarms. Coexiste con los
 * endpoints en vivo de integrations (no se eliminan).
 *
 * Permiso 'devices' (no existe módulo 'alarms' en el catálogo backend;
 * crearlo exigiría migración 035: las alarmas viven bajo 'devices',
 * igual que alarms/recent y alarms/current y el mapeo del frontend).
 */
const router = Router();

router.use(requireModuleAccess('devices'));

// /summary ANTES de /:id para que "summary" no se interprete como id.
router.get('/summary', getSummary);
router.get('/:id', getAlarm);
router.get('/', listAlarms);

export default router;
