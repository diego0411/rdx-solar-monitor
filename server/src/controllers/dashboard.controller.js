import { getDashboardSummary } from '../services/dashboard.service.js';

export async function getSummary(req, res) {
  try {
    return res.json(await getDashboardSummary());
  } catch {
    return res.status(503).json({ error: 'No se pudo consultar el resumen del dashboard' });
  }
}
