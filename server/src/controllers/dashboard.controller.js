import { getDashboardSummary } from '../services/dashboard.service.js';

export async function getSummary(req, res) {
  try {
    return res.json(await getDashboardSummary(req.scope?.plantIds ?? null));
  } catch (error) {
    console.error('Dashboard summary failed:', error);
    return res.status(503).json({ error: 'No se pudo consultar el resumen del dashboard' });
  }
}
