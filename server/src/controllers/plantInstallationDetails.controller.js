import { plantInScope } from '../middleware/authorization.middleware.js';
import {
  getPlantInstallationDetails,
  upsertPlantInstallationDetails,
} from '../repositories/plantInstallationDetails.repository.js';
import { getStoredPlantById } from '../repositories/plants.repository.js';

const plantIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const textFields = ['panel_manufacturer', 'panel_model', 'orientation'];
const fields = ['installed_at', ...textFields, 'panel_count', 'panel_power_w', 'tilt_degrees'];

export function emptyInstallationDetails() {
  return Object.fromEntries(fields.map(field => [field, null]));
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

export function validateInstallationDetails(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !fields.includes(key))) return null;
  if (body.installed_at !== undefined && body.installed_at !== null
      && !validDate(body.installed_at)) return null;
  if (textFields.some(field => body[field] !== undefined
      && !(body[field] === null || (typeof body[field] === 'string'
        && body[field].trim().length <= 160)))) return null;
  if (body.panel_count !== undefined && body.panel_count !== null
      && (!Number.isInteger(body.panel_count) || body.panel_count <= 0)) return null;
  if (body.panel_power_w !== undefined && body.panel_power_w !== null
      && (typeof body.panel_power_w !== 'number' || !Number.isFinite(body.panel_power_w)
        || body.panel_power_w <= 0)) return null;
  if (body.tilt_degrees !== undefined && body.tilt_degrees !== null
      && (typeof body.tilt_degrees !== 'number' || !Number.isFinite(body.tilt_degrees)
        || body.tilt_degrees < 0 || body.tilt_degrees > 90)) return null;
  return Object.fromEntries(fields.map(field => {
    const value = body[field];
    return [field, typeof value === 'string' ? value.trim() || null : value ?? null];
  }));
}

function validatePlantRequest(req, res) {
  const plantId = req.params.plantId?.toLowerCase();
  if (!plantIdPattern.test(plantId ?? '')) {
    res.status(400).json({ error: 'plantId inválido' });
    return null;
  }
  if (!plantInScope(req.scope, plantId)) {
    res.status(404).json({ error: 'Planta no encontrada' });
    return null;
  }
  return plantId;
}

export async function getInstallationDetails(req, res) {
  const plantId = validatePlantRequest(req, res);
  if (!plantId) return;
  try {
    if (!await getStoredPlantById(plantId)) {
      return res.status(404).json({ error: 'Planta no encontrada' });
    }
    return res.json(await getPlantInstallationDetails(plantId) ?? emptyInstallationDetails());
  } catch {
    return res.status(503).json({ error: 'No se pudo consultar la información de instalación' });
  }
}

export async function putInstallationDetails(req, res) {
  const plantId = validatePlantRequest(req, res);
  if (!plantId) return;
  if (!['rdx_admin', 'client_admin'].includes(req.profile?.role)) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  const values = validateInstallationDetails(req.body);
  if (!values) return res.status(400).json({ error: 'Información de instalación inválida' });
  try {
    if (!await getStoredPlantById(plantId)) {
      return res.status(404).json({ error: 'Planta no encontrada' });
    }
    return res.json(await upsertPlantInstallationDetails(plantId, values));
  } catch {
    return res.status(503).json({ error: 'No se pudo guardar la información de instalación' });
  }
}
