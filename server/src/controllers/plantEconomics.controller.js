import { getStoredPlantById } from '../repositories/plants.repository.js';
import {
  createPlantEnergyTariff,
  getPlantEnergyTariff,
  listPlantEnergyTariffs,
  updatePlantEnergyTariff,
} from '../repositories/plantEnergyTariffs.repository.js';
import { getPlantEconomicSummary } from '../services/plantEconomics.service.js';
import { plantInScope } from '../middleware/authorization.middleware.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const periods = new Set(['day', 'week', 'month', 'year']);
const compensationTypes = new Set(['energy_credit', 'monetary', 'none']);
const editableFields = [
  'effective_from', 'effective_to', 'purchase_energy_rate', 'export_energy_rate',
  'currency', 'export_compensation_type', 'distributor', 'tariff_category',
];

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function optionalText(value, maxLength) {
  return value === undefined || value === null
    || (typeof value === 'string' && value.trim().length <= maxLength);
}

function rate(value, required = false) {
  if (value === null || value === undefined) return !required;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function canManageEconomicTariffs(role) {
  return role === 'rdx_admin' || role === 'client_admin';
}

function sameTariffValue(field, left, right) {
  if (['purchase_energy_rate', 'export_energy_rate'].includes(field)) {
    if (left === null && right === null) return true;
    return Number(left) === Number(right);
  }
  return (left ?? null) === (right ?? null);
}

export function validateEnergyTariff(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !editableFields.includes(key))) return null;
  const required = ['effective_from', 'purchase_energy_rate', 'currency', 'export_compensation_type'];
  if (!partial && required.some(field => input[field] === undefined)) return null;
  if (input.effective_from !== undefined && !validDate(input.effective_from)) return null;
  if (input.effective_to !== undefined && input.effective_to !== null && !validDate(input.effective_to)) return null;
  if (!rate(input.purchase_energy_rate, !partial)) return null;
  if (!rate(input.export_energy_rate)) return null;
  if (input.currency !== undefined
      && (typeof input.currency !== 'string' || !/^[A-Za-z]{3,8}$/.test(input.currency.trim()))) return null;
  if (input.export_compensation_type !== undefined
      && !compensationTypes.has(input.export_compensation_type)) return null;
  if (!optionalText(input.distributor, 120) || !optionalText(input.tariff_category, 120)) return null;

  const values = Object.fromEntries(Object.entries(input).map(([key, value]) => [
    key,
    key === 'currency' && typeof value === 'string' ? value.trim().toUpperCase()
      : typeof value === 'string' ? value.trim() || null : value,
  ]));
  if (values.effective_from && values.effective_to && values.effective_to < values.effective_from) return null;
  if (values.export_compensation_type === 'monetary'
      && (values.export_energy_rate === null || values.export_energy_rate === undefined)) return null;
  return values;
}

function requestAllowed(req, res) {
  if (!uuidPattern.test(req.params.plantId)) {
    res.status(400).json({ error: 'plantId inválido' });
    return false;
  }
  if (!plantInScope(req.scope, req.params.plantId.toLowerCase())) {
    res.status(404).json({ error: 'Planta no encontrada' });
    return false;
  }
  return true;
}

async function plantExists(plantId, res) {
  if (await getStoredPlantById(plantId)) return true;
  res.status(404).json({ error: 'Planta no encontrada' });
  return false;
}

export async function getPlantEnergyTariffs(req, res) {
  if (!requestAllowed(req, res)) return;
  try {
    if (!await plantExists(req.params.plantId, res)) return;
    return res.json(await listPlantEnergyTariffs(req.params.plantId));
  } catch {
    return res.status(503).json({ error: 'No se pudieron consultar las tarifas de energía' });
  }
}

export async function postPlantEnergyTariff(req, res) {
  if (!canManageEconomicTariffs(req.profile?.role)) return res.status(403).json({ error: 'Acceso denegado' });
  if (!requestAllowed(req, res)) return;
  const values = validateEnergyTariff(req.body);
  if (!values) return res.status(400).json({ error: 'Tarifa de energía inválida' });
  try {
    if (!await plantExists(req.params.plantId, res)) return;
    return res.status(201).json(await createPlantEnergyTariff(req.params.plantId, values));
  } catch (error) {
    return res.status(error.statusCode ?? 503).json({ error: error.message });
  }
}

export async function patchPlantEnergyTariff(req, res) {
  if (!canManageEconomicTariffs(req.profile?.role)) return res.status(403).json({ error: 'Acceso denegado' });
  if (!requestAllowed(req, res) || !uuidPattern.test(req.params.tariffId)) {
    if (!res.headersSent) return res.status(400).json({ error: 'tariffId inválido' });
    return;
  }
  const values = validateEnergyTariff(req.body, { partial: true });
  if (!values || !Object.keys(values).length) return res.status(400).json({ error: 'Tarifa de energía inválida' });
  try {
    if (!await plantExists(req.params.plantId, res)) return;
    const existing = await getPlantEnergyTariff(req.params.plantId, req.params.tariffId);
    if (!existing) return res.status(404).json({ error: 'Tarifa no encontrada' });
    const today = new Date().toISOString().slice(0, 10);
    if (existing.effective_from <= today) {
      if (Object.entries(values).some(([key, value]) => key !== 'effective_to'
          && !sameTariffValue(key, value, existing[key]))
          || (values.effective_to !== null && values.effective_to < today)) {
        return res.status(409).json({ error: 'Una tarifa ya vigente solo puede cerrarse desde la fecha actual' });
      }
    }
    const currentValues = Object.fromEntries(editableFields.map(field => [field, existing[field]]));
    const merged = validateEnergyTariff({ ...currentValues, ...values });
    if (!merged) return res.status(400).json({ error: 'Tarifa de energía inválida' });
    const updated = await updatePlantEnergyTariff(req.params.plantId, req.params.tariffId, values);
    return updated ? res.json(updated) : res.status(404).json({ error: 'Tarifa no encontrada' });
  } catch (error) {
    return res.status(error.statusCode ?? 503).json({ error: error.message });
  }
}

export async function getPlantEconomicSummaryController(req, res) {
  const { period, startTime } = req.query;
  if (!requestAllowed(req, res)) return;
  if (!periods.has(period) || !validDate(startTime)) {
    return res.status(400).json({ error: 'period o startTime inválidos' });
  }
  try {
    if (!await plantExists(req.params.plantId, res)) return;
    return res.json(await getPlantEconomicSummary(req.params.plantId, period, startTime));
  } catch {
    return res.status(503).json({ error: 'No se pudo calcular el resumen económico' });
  }
}
