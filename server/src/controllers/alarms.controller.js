import { getAlarmDetail, getAlarmsSummary, listAlarmsPage } from '../repositories/alarms.repository.js';

const STATUSES = ['active', 'resolved'];
const SEVERITIES = ['information', 'warning', 'critical'];
const PROVIDERS = ['hyxi', 'growatt'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_LENGTH = 100;
const SENSITIVE_KEY_RE = /token|authorization|password|secret|api[_-]?key/i;

function invalid(res, message) {
  return res.status(400).json({ error: message });
}

function parsePositiveInt(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return NaN;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : NaN;
}

function parseDate(value) {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function shapePlant(plant) {
  if (!plant) return null;
  return { id: plant.id ?? null, name: plant.name ?? null };
}

function shapeDevice(device) {
  if (!device) return null;
  return {
    id: device.id ?? null,
    name: device.name ?? null,
    serial_number: device.serial_number ?? null,
    device_type: device.device_type ?? null,
  };
}

function shapeAlarm(row) {
  return {
    id: row.id,
    provider: row.provider,
    alarm_code: row.alarm_code,
    title: row.title,
    description: row.description ?? null,
    severity: row.severity ?? null,
    status: row.status,
    started_at: row.started_at ?? null,
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    resolved_at: row.resolved_at ?? null,
    plant: shapePlant(row.plant),
    device: shapeDevice(row.device),
  };
}

// Sanitiza solo la respuesta HTTP (nunca la BD): poda recursivamente
// cualquier clave con pinta de secreto, por si el fabricante alguna vez
// incluye campos inesperados en raw_payload.
export function sanitizeSecrets(value) {
  if (Array.isArray(value)) return value.map(sanitizeSecrets);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SENSITIVE_KEY_RE.test(key) ? '[REDACTED]' : sanitizeSecrets(entry),
      ]),
    );
  }
  return value;
}

export async function listAlarms(req, res) {
  const { status, severity, provider, plantId, deviceId, dateFrom, dateTo, search } = req.query;
  if (status !== undefined && !STATUSES.includes(status)) return invalid(res, 'status debe ser active|resolved');
  if (severity !== undefined && !SEVERITIES.includes(severity)) return invalid(res, 'severity debe ser information|warning|critical');
  if (provider !== undefined && !PROVIDERS.includes(provider)) return invalid(res, 'provider debe ser hyxi|growatt');
  if (plantId !== undefined && !UUID_RE.test(plantId)) return invalid(res, 'plantId debe ser un UUID válido');
  if (deviceId !== undefined && !UUID_RE.test(deviceId)) return invalid(res, 'deviceId debe ser un UUID válido');
  const from = dateFrom === undefined ? null : parseDate(dateFrom);
  if (dateFrom !== undefined && !from) return invalid(res, 'dateFrom debe ser una fecha ISO válida');
  const to = dateTo === undefined ? null : parseDate(dateTo);
  if (dateTo !== undefined && !to) return invalid(res, 'dateTo debe ser una fecha ISO válida');
  if (from && to && from > to) return invalid(res, 'dateFrom no puede ser posterior a dateTo');
  if (search !== undefined && (typeof search !== 'string' || !search.trim())) return invalid(res, 'search debe ser texto no vacío');
  if (search !== undefined && search.trim().length > MAX_SEARCH_LENGTH) return invalid(res, 'search demasiado largo');
  const page = parsePositiveInt(req.query.page, 1);
  if (!Number.isSafeInteger(page) || page < 1) return invalid(res, 'page debe ser un entero positivo');
  const pageSize = parsePositiveInt(req.query.pageSize, 20);
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    return invalid(res, `pageSize debe ser un entero entre 1 y ${MAX_PAGE_SIZE}`);
  }

  const plantIds = req.scope?.plantIds ?? null;
  const normalizedPlantId = plantId === undefined ? null : plantId.toLowerCase();
  // plantId fuera del alcance: página vacía segura, sin filtrar nada.
  if (normalizedPlantId && plantIds !== null && !plantIds.has(normalizedPlantId)) {
    return res.json({ alarms: [], pagination: { page, page_size: pageSize, total: 0, total_pages: 0 } });
  }
  try {
    const { alarms, total } = await listAlarmsPage({
      plantIds,
      provider: provider ?? null,
      status: status ?? null,
      severity: severity ?? null,
      plantId: normalizedPlantId,
      deviceId: deviceId === undefined ? null : deviceId.toLowerCase(),
      dateFrom: from,
      dateTo: to,
      search: search === undefined ? null : search.trim(),
      page,
      pageSize,
    });
    return res.json({
      alarms: alarms.map(shapeAlarm),
      pagination: {
        page,
        page_size: pageSize,
        total,
        total_pages: total === 0 ? 0 : Math.ceil(total / pageSize),
      },
    });
  } catch {
    return res.status(503).json({ error: 'No se pudieron consultar las alarmas' });
  }
}

export async function getAlarm(req, res) {
  const { id } = req.params;
  if (!UUID_RE.test(id ?? '')) return invalid(res, 'id debe ser un UUID válido');
  try {
    const alarm = await getAlarmDetail(id.toLowerCase(), req.scope?.plantIds ?? null);
    if (!alarm) return res.status(404).json({ error: 'Alarma no encontrada' });
    return res.json({ ...shapeAlarm(alarm), raw_payload: sanitizeSecrets(alarm.raw_payload ?? null) });
  } catch {
    return res.status(503).json({ error: 'No se pudo consultar la alarma' });
  }
}

export async function getSummary(req, res) {
  try {
    const resolvedSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const summary = await getAlarmsSummary({ plantIds: req.scope?.plantIds ?? null, resolvedSince });
    return res.json({
      active: summary.active,
      critical: summary.critical,
      warning: summary.warning,
      resolved_7d: summary.resolved_7d,
    });
  } catch {
    return res.status(503).json({ error: 'No se pudo consultar el resumen de alarmas' });
  }
}
