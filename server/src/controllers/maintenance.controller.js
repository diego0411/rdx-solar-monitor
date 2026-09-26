import { plantInScope } from '../middleware/authorization.middleware.js';
import {
  getMaintenanceVisitById,
  insertMaintenanceVisit,
  listMaintenanceVisits,
  updateMaintenanceVisit,
} from '../repositories/maintenanceVisits.repository.js';
import {
  deleteMaintenanceActivity,
  getDevicePlant,
  getMaintenanceActivityById,
  insertMaintenanceActivity,
  listActivitiesByVisitId,
  updateMaintenanceActivity,
} from '../repositories/maintenanceActivities.repository.js';
import { getStoredPlantById } from '../repositories/plants.repository.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const priorities = ['low', 'normal', 'high', 'urgent'];
const statuses = ['scheduled', 'in_progress', 'completed', 'cancelled'];
const activityTypes = ['inspection', 'preventive', 'corrective', 'cleaning', 'other'];
const writableRoles = ['rdx_admin', 'client_admin'];

const createFields = [
  'plant_id', 'title', 'description', 'priority', 'status', 'scheduled_at',
  'technician_name', 'general_observations', 'service_amount', 'currency',
  'next_maintenance_at', 'next_maintenance_notes',
];
const patchFields = [
  'title', 'description', 'priority', 'scheduled_at', 'technician_name',
  'general_observations', 'service_amount', 'currency',
  'next_maintenance_at', 'next_maintenance_notes',
];
const activityCreateFields = [
  'activity_type', 'title', 'device_id', 'work_performed', 'findings',
  'actions_taken', 'observations',
];
const activityLongTexts = ['work_performed', 'findings', 'actions_taken', 'observations'];
const statusTargets = ['in_progress', 'completed', 'cancelled'];
const statusTransitions = {
  scheduled: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

function validUuid(value) {
  return typeof value === 'string' && uuidPattern.test(value);
}

function validDateTime(value) {
  return typeof value === 'string' && value.length <= 64
    && Number.isFinite(Date.parse(value));
}

function cleanText(value, max) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > max) return undefined;
  return value.trim();
}

function cleanAmount(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

function cleanValues(body, fields) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const values = {};
  for (const field of fields) {
    const raw = body[field];
    if (raw === undefined) continue;
    if (field === 'plant_id') {
      if (!validUuid(raw)) return null;
      values.plant_id = raw.toLowerCase();
    } else if (field === 'title') {
      const title = cleanText(raw, 200);
      if (title === undefined) return null;
      values.title = title;
    } else if (['description', 'general_observations', 'next_maintenance_notes'].includes(field)) {
      const text = cleanText(raw, 4000);
      if (text === undefined) return null;
      values[field] = text;
    } else if (field === 'technician_name') {
      const name = cleanText(raw, 160);
      if (name === undefined) return null;
      values.technician_name = name;
    } else if (field === 'currency') {
      const currency = cleanText(raw, 10);
      if (currency === undefined) return null;
      values.currency = currency;
    } else if (field === 'priority') {
      if (!priorities.includes(raw)) return null;
      values.priority = raw;
    } else if (field === 'status') {
      if (!statuses.includes(raw)) return null;
      values.status = raw;
    } else if (['scheduled_at', 'next_maintenance_at'].includes(field)) {
      if (raw !== null && !validDateTime(raw)) return null;
      values[field] = raw ?? null;
    } else if (field === 'service_amount') {
      const amount = cleanAmount(raw);
      if (amount === undefined) return null;
      values.service_amount = amount;
    }
  }
  return values;
}

function requireWriter(req, res) {
  if (!writableRoles.includes(req.profile?.role)) {
    res.status(403).json({ error: 'Acceso denegado' });
    return false;
  }
  return true;
}

function cleanActivityValues(body, { forPatch = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const values = {};
  for (const field of activityCreateFields) {
    const raw = body[field];
    if (raw === undefined) continue;
    if (field === 'activity_type') {
      if (!activityTypes.includes(raw)) return null;
      values.activity_type = raw;
    } else if (field === 'title') {
      const title = cleanText(raw, 200);
      if (title === undefined || (forPatch && title === null)) return null;
      values.title = title;
    } else if (field === 'device_id') {
      if (raw !== null && !validUuid(raw)) return null;
      values.device_id = raw === null ? null : raw.toLowerCase();
    } else if (activityLongTexts.includes(field)) {
      const text = cleanText(raw, 4000);
      if (text === undefined) return null;
      values[field] = text;
    }
  }
  return values;
}

async function resolveVisit(req, res) {
  const id = req.params.id?.toLowerCase();
  if (!validUuid(id)) {
    res.status(400).json({ error: 'id inválido' });
    return null;
  }
  try {
    const visit = await getMaintenanceVisitById(id);
    if (!visit || !plantInScope(req.scope, visit.plant_id)) {
      res.status(404).json({ error: 'Visita no encontrada' });
      return null;
    }
    return visit;
  } catch {
    res.status(503).json({ error: 'No se pudo consultar la visita de mantenimiento' });
    return null;
  }
}

async function resolveActivityDevice(req, res, visit, deviceId) {
  if (deviceId === null || deviceId === undefined) return null;
  try {
    const device = await getDevicePlant(deviceId);
    if (!device || device.plant_id !== visit.plant_id
        || !plantInScope(req.scope, device.plant_id)) {
      res.status(404).json({ error: 'Dispositivo no encontrado' });
      return undefined;
    }
    return device.id;
  } catch {
    res.status(503).json({ error: 'No se pudo consultar el dispositivo' });
    return undefined;
  }
}

async function resolveVisitActivity(req, res, visit) {
  const activityId = req.params.activityId?.toLowerCase();
  if (!validUuid(activityId)) {
    res.status(400).json({ error: 'activityId inválido' });
    return null;
  }
  try {
    const activity = await getMaintenanceActivityById(activityId);
    if (!activity || activity.maintenance_visit_id !== visit.id) {
      res.status(404).json({ error: 'Actividad no encontrada' });
      return null;
    }
    return activity;
  } catch {
    res.status(503).json({ error: 'No se pudo consultar la actividad de mantenimiento' });
    return null;
  }
}

export async function listMaintenance(req, res) {
  const { plantId, status, dateFrom, dateTo } = req.query ?? {};
  if (plantId !== undefined && !validUuid(plantId)) {
    return res.status(400).json({ error: 'plantId inválido' });
  }
  if (status !== undefined && !statuses.includes(status)) {
    return res.status(400).json({ error: 'status inválido' });
  }
  if (dateFrom !== undefined && !validDateTime(dateFrom)) {
    return res.status(400).json({ error: 'dateFrom inválido' });
  }
  if (dateTo !== undefined && !validDateTime(dateTo)) {
    return res.status(400).json({ error: 'dateTo inválido' });
  }
  try {
    let plantIds = req.scope?.plantIds ?? new Set();
    if (plantId !== undefined) {
      const normalized = plantId.toLowerCase();
      if (!plantInScope(req.scope, normalized)) return res.json([]);
      plantIds = new Set([normalized]);
    }
    return res.json(await listMaintenanceVisits({
      plantIds, status: status ?? null,
      dateFrom: dateFrom ?? null, dateTo: dateTo ?? null,
    }));
  } catch {
    return res.status(503).json({ error: 'No se pudieron consultar las visitas de mantenimiento' });
  }
}

export async function getMaintenance(req, res) {
  const id = req.params.id?.toLowerCase();
  if (!validUuid(id)) return res.status(400).json({ error: 'id inválido' });
  try {
    const visit = await getMaintenanceVisitById(id);
    if (!visit || !plantInScope(req.scope, visit.plant_id)) {
      return res.status(404).json({ error: 'Visita no encontrada' });
    }
    return res.json({ ...visit, activities: await listActivitiesByVisitId(id) });
  } catch {
    return res.status(503).json({ error: 'No se pudo consultar la visita de mantenimiento' });
  }
}

export async function postMaintenance(req, res) {
  if (!requireWriter(req, res)) return;
  const values = cleanValues(req.body, createFields);
  if (!values || !values.plant_id || !values.title) {
    return res.status(400).json({ error: 'Visita de mantenimiento inválida' });
  }
  if (values.status === 'completed') {
    return res.status(400).json({ error: 'La finalización se gestiona con el flujo explícito' });
  }
  try {
    if (!plantInScope(req.scope, values.plant_id)
        || !await getStoredPlantById(values.plant_id)) {
      return res.status(404).json({ error: 'Planta no encontrada' });
    }
    return res.status(201).json(await insertMaintenanceVisit({
      ...values, created_by: req.profile.id,
    }));
  } catch {
    return res.status(503).json({ error: 'No se pudo registrar la visita de mantenimiento' });
  }
}

export async function patchMaintenance(req, res) {
  if (!requireWriter(req, res)) return;
  const id = req.params.id?.toLowerCase();
  if (!validUuid(id)) return res.status(400).json({ error: 'id inválido' });
  const values = cleanValues(req.body, patchFields);
  if (values && values.title !== undefined && !values.title) {
    return res.status(400).json({ error: 'Visita de mantenimiento inválida' });
  }
  if (!values || Object.keys(values).length === 0) {
    return res.status(400).json({ error: 'Nada que actualizar' });
  }
  try {
    const visit = await getMaintenanceVisitById(id);
    if (!visit || !plantInScope(req.scope, visit.plant_id)) {
      return res.status(404).json({ error: 'Visita no encontrada' });
    }
    return res.json(await updateMaintenanceVisit(id, values));
  } catch {
    return res.status(503).json({ error: 'No se pudo actualizar la visita de mantenimiento' });
  }
}

export async function postActivity(req, res) {
  if (!requireWriter(req, res)) return;
  const visit = await resolveVisit(req, res);
  if (!visit) return;
  const values = cleanActivityValues(req.body);
  if (!values || !values.activity_type || !values.title) {
    return res.status(400).json({ error: 'Actividad de mantenimiento inválida' });
  }
  const deviceId = await resolveActivityDevice(
    req, res, visit, values.device_id ?? null);
  if (deviceId === undefined) return;
  try {
    return res.status(201).json(await insertMaintenanceActivity({
      ...values, device_id: deviceId, maintenance_visit_id: visit.id,
    }));
  } catch {
    return res.status(503).json({ error: 'No se pudo registrar la actividad de mantenimiento' });
  }
}

export async function patchActivity(req, res) {
  if (!requireWriter(req, res)) return;
  const visit = await resolveVisit(req, res);
  if (!visit) return;
  const activity = await resolveVisitActivity(req, res, visit);
  if (!activity) return;
  const values = cleanActivityValues(req.body, { forPatch: true });
  if (!values || Object.keys(values).length === 0) {
    return res.status(400).json({ error: 'Nada que actualizar' });
  }
  if (values.device_id !== undefined) {
    const deviceId = await resolveActivityDevice(req, res, visit, values.device_id);
    if (deviceId === undefined) return;
    values.device_id = deviceId;
  }
  try {
    return res.json(await updateMaintenanceActivity(activity.id, values));
  } catch {
    return res.status(503).json({ error: 'No se pudo actualizar la actividad de mantenimiento' });
  }
}

export async function deleteActivity(req, res) {
  if (!requireWriter(req, res)) return;
  const visit = await resolveVisit(req, res);
  if (!visit) return;
  const activity = await resolveVisitActivity(req, res, visit);
  if (!activity) return;
  try {
    await deleteMaintenanceActivity(activity.id);
    return res.json({ deleted: true, id: activity.id });
  } catch {
    return res.status(503).json({ error: 'No se pudo eliminar la actividad de mantenimiento' });
  }
}

export async function patchMaintenanceStatus(req, res) {
  if (!requireWriter(req, res)) return;
  const visit = await resolveVisit(req, res);
  if (!visit) return;
  const next = req.body?.status;
  if (!statusTargets.includes(next)) {
    return res.status(400).json({ error: 'status inválido' });
  }
  if (!statusTransitions[visit.status]?.includes(next)) {
    return res.status(400).json({ error: 'Transición de estado no permitida' });
  }
  try {
    if (next === 'completed') {
      const activities = await listActivitiesByVisitId(visit.id);
      if (activities.length === 0) {
        return res.status(400).json({ error: 'La visita requiere al menos una actividad para completarse' });
      }
      return res.json(await updateMaintenanceVisit(visit.id, {
        status: 'completed', completed_at: new Date().toISOString(),
      }));
    }
    return res.json(await updateMaintenanceVisit(visit.id, {
      status: next, completed_at: null,
    }));
  } catch {
    return res.status(503).json({ error: 'No se pudo actualizar el estado de la visita' });
  }
}
