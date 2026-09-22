import { getStoredPlantById } from '../repositories/plants.repository.js';
import { getPlantFinancialProfile, upsertPlantFinancialProfile } from '../repositories/plantFinancialProfiles.repository.js';
import { plantInScope } from '../middleware/authorization.middleware.js';

const plantIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const numericFields = ['baseline_monthly_bill', 'purchase_energy_rate', 'export_energy_rate', 'system_investment'];
const fields = [...numericFields, 'installation_date'];

function emptyProfile() {
  return Object.fromEntries(fields.map(field => [field, null]));
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}

function validProfile(body) {
  return body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).every(key => fields.includes(key))
    && numericFields.every(key => body[key] === undefined || body[key] === null
      || (typeof body[key] === 'number' && Number.isFinite(body[key]) && body[key] >= 0))
    && (body.installation_date === undefined || body.installation_date === null
      || validDate(body.installation_date));
}

export async function getPlantFinancial(req, res) {
  if (!plantIdPattern.test(req.params.plantId)) return res.status(400).json({ error: 'plantId inválido' });
  if (!plantInScope(req.scope, req.params.plantId.toLowerCase())) {
    return res.status(404).json({ error: 'Planta no encontrada' });
  }
  try {
    if (!await getStoredPlantById(req.params.plantId)) return res.status(404).json({ error: 'Planta no encontrada' });
    return res.json(await getPlantFinancialProfile(req.params.plantId) ?? emptyProfile());
  } catch {
    return res.status(503).json({ error: 'No se pudo consultar el perfil financiero' });
  }
}

export async function putPlantFinancial(req, res) {
  if (!plantIdPattern.test(req.params.plantId)) return res.status(400).json({ error: 'plantId inválido' });
  if (!validProfile(req.body)) return res.status(400).json({ error: 'Perfil financiero inválido' });
  if (!plantInScope(req.scope, req.params.plantId.toLowerCase())) {
    return res.status(404).json({ error: 'Planta no encontrada' });
  }
  if (req.profile?.role !== 'rdx_admin' && req.profile?.role !== 'client_admin') {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  try {
    if (!await getStoredPlantById(req.params.plantId)) return res.status(404).json({ error: 'Planta no encontrada' });
    const values = Object.fromEntries(fields.map(field => [field, req.body[field] ?? null]));
    return res.json(await upsertPlantFinancialProfile(req.params.plantId, values));
  } catch {
    return res.status(503).json({ error: 'No se pudo guardar el perfil financiero' });
  }
}
