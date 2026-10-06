import { HyxiProvider } from '../providers/hyxi/HyxiProvider.js';
import { listActiveHyxiPlants } from '../repositories/plants.repository.js';
import { listStoredDevices } from '../repositories/devices.repository.js';
import {
  createAlarmEpisode,
  createResolvedAlarmEpisode,
  findAlarmByExternalId,
  resolveAlarm,
  touchActiveAlarm,
  touchAlarmObservation,
} from '../repositories/alarms.repository.js';

/*
 * Persistencia de episodios HYXi en public.alarms (endpoint REAL validado
 * en vivo 2026-10-06: POST /api/alarm/v1/plantAlarmPage).
 *
 * Reglas V1 (evidencia viva, 7 episodios SFV_Juana Consuelo):
 * - Identidad del episodio: external_alarm_id = String(item.id).
 *   El mismo (deviceSn, alarmCode) reaparece con IDs distintos: NO
 *   deduplicar por código. Cada id es un episodio propio.
 * - "HYXi status derived by RDX from manufacturer endTime presence;
 *   alarmState preserved raw until semantics are confirmed." alarmState
 *   (0/1/2) NO determina status: los 7 observados traen state=2 con
 *   endTime poblado. Regla: endTime válido > 0 -> resolved, si no active.
 * - alarmLevel NO se mapea a severity (semántica desconocida):
 *   severity = NULL siempre; alarmLevel queda en raw_payload.
 * - Resolución SOLO por endTime del fabricante. NUNCA por ausencia en
 *   pageData (la página devuelve histórico/episodios, no solo activas).
 *
 * CONCURRENCIA: 034 solo tiene UNIQUE PARCIALES sobre
 * status='active'. La migración 035 agrega
 *   UNIQUE (provider, external_alarm_id) WHERE external_alarm_id IS NOT NULL
 * (no afecta a Growatt: sus filas tienen external_alarm_id NULL y el
 * índice parcial las excluye). Los create capturan 23505 y releen por ID
 * externo: dos procesos concurrentes ante el mismo evento terminan con
 * una sola fila. Sin retry de INSERT; 23505 sin fila visible falla
 * explícitamente.
 *
 * Aislamiento: solo lee plantas/devices y escribe public.alarms. Una
 * falla aquí jamás toca telemetría/energía. Cero llamadas de escritura
 * al fabricante (sin alterAlarm/subscribe/cancel).
 */

const PAGE_SIZE = 100;

function usableText(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!text || text.toLowerCase() === 'unknown') return null;
  return text;
}

function validMs(value) {
  const ms = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const time = new Date(ms).getTime();
  return Number.isFinite(time) ? new Date(ms).toISOString() : null;
}

export function normalizeHyxiAlarmItem(item, observedAt = null) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const observed = (typeof observedAt === 'string' && observedAt) || new Date().toISOString();
  const externalAlarmId = typeof item.id === 'number' && Number.isFinite(item.id)
    ? String(item.id)
    : usableText(item.id);
  const alarmCode = usableText(item.alarmCode);
  if (!externalAlarmId || !alarmCode) return null;
  const startedAt = validMs(item.beginTime);
  const resolvedAt = validMs(item.endTime);
  return {
    externalAlarmId,
    alarmCode,
    title: usableText(item.alarmName) ?? `HYXi alarm ${alarmCode}`,
    severity: null,
    status: resolvedAt ? 'resolved' : 'active',
    startedAt,
    resolvedAt,
    firstSeenAt: observed,
    lastSeenAt: observed,
    rawPayload: {
      ...item,
      _rdx: {
        observed_at: observed,
        status_rule: 'HYXi status derived by RDX from manufacturer endTime presence; alarmState preserved raw until semantics are confirmed.',
      },
    },
  };
}

function sanitizedMessage(error) {
  const message = String(error?.providerMsg ?? error?.message ?? 'HYXi alarm sync failed');
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\b(token|secret|authorization)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .slice(0, 300);
}

function extractPageData(payload) {
  if (payload?.success !== true || String(payload?.code ?? '') !== '0') {
    throw new Error('Invalid HYXi plant alarms response');
  }
  const data = payload?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid HYXi plant alarms response');
  }
  if (!Array.isArray(data.pageData)) throw new Error('Invalid HYXi plant alarms response');
  const totalPages = Number(data.totalPage);
  return {
    items: data.pageData,
    totalPages: Number.isSafeInteger(totalPages) && totalPages > 0 ? totalPages : 1,
  };
}

export function createHyxiAlarmSync({
  listPlants = listActiveHyxiPlants,
  provider = new HyxiProvider(),
  listDevices = (plantIds) => listStoredDevices(plantIds),
  repository = {
    findAlarmByExternalId,
    createAlarmEpisode,
    createResolvedAlarmEpisode,
    touchActiveAlarm,
    touchAlarmObservation,
    resolveAlarm,
  },
  now = () => new Date().toISOString(),
  pageSize = PAGE_SIZE,
  logger = console,
} = {}) {
  async function persistEpisode(plant, deviceId, episode, result) {
    const existing = await repository.findAlarmByExternalId('hyxi', episode.externalAlarmId);
    if (!existing) {
      if (episode.status === 'resolved') {
        const { alarm } = await repository.createResolvedAlarmEpisode({
          plantId: plant.id,
          deviceId,
          provider: 'hyxi',
          externalAlarmId: episode.externalAlarmId,
          alarmCode: episode.alarmCode,
          title: episode.title,
          description: null,
          severity: null,
          startedAt: episode.startedAt,
          resolvedAt: episode.resolvedAt,
          firstSeenAt: episode.firstSeenAt,
          lastSeenAt: episode.lastSeenAt,
          rawPayload: episode.rawPayload,
        });
        result.resolved.push(alarm.id);
        return;
      }
      const { alarm } = await repository.createAlarmEpisode({
        plantId: plant.id,
        deviceId,
        provider: 'hyxi',
        externalAlarmId: episode.externalAlarmId,
        alarmCode: episode.alarmCode,
        title: episode.title,
        description: null,
        severity: null,
        startedAt: episode.startedAt,
        firstSeenAt: episode.firstSeenAt,
        lastSeenAt: episode.lastSeenAt,
        rawPayload: episode.rawPayload,
      });
      result.created.push(alarm.id);
      return;
    }
    if (existing.status === 'active' && episode.status === 'resolved') {
      const closed = await repository.resolveAlarm(existing.id, { resolvedAt: episode.resolvedAt });
      if (closed) {
        result.resolved.push(closed.id);
        return;
      }
    }
    if (existing.status === 'active') {
      const touched = await repository.touchActiveAlarm(existing.id, {
        lastSeenAt: episode.lastSeenAt, rawPayload: episode.rawPayload,
      });
      if (touched) result.touched.push(touched.id);
      return;
    }
    // Episodio ya resuelto re-observado: solo refresca observación con la
    // información más reciente. Un poll sin endTime sobre un episodio ya
    // resuelto NO lo reabre (sin semántica de reapertura documentada).
    const touched = await repository.touchAlarmObservation(existing.id, {
      lastSeenAt: episode.lastSeenAt, rawPayload: episode.rawPayload,
    });
    if (touched) result.touched.push(touched.id);
  }

  async function syncPlant(plant, result) {
    const devices = await listDevices(new Set([plant.id]));
    const bySerial = new Map();
    for (const device of devices ?? []) {
      if (device && device.serial_number != null && device.plant_id === plant.id && !bySerial.has(device.serial_number)) {
        bySerial.set(device.serial_number, device.id);
      }
    }
    let page = 1;
    for (;;) {
      const payload = await provider.getPlantAlarms(plant.external_plant_id, page, pageSize);
      const { items, totalPages } = extractPageData(payload);
      const observed = now();
      for (const item of items) {
        const episode = normalizeHyxiAlarmItem(item, observed);
        if (!episode) {
          result.skipped += 1;
          continue;
        }
        const serial = item?.deviceSn == null ? null : String(item.deviceSn);
        await persistEpisode(plant, (serial && bySerial.get(serial)) || null, episode, result);
      }
      if (page >= totalPages || items.length === 0) break;
      page += 1;
    }
  }

  return async function syncHyxiAlarms() {
    const result = {
      checked_plants: 0, failed_plants: 0, created: [], touched: [], resolved: [], skipped: 0, failures: [],
    };
    const plants = await listPlants();
    for (const plant of plants ?? []) {
      try {
        await syncPlant(plant, result);
        result.checked_plants += 1;
      } catch (error) {
        // Aborta SOLO esta planta: la página fallida no deja marca parcial
        // interpretable y jamás implica resolución por ausencia.
        result.failed_plants += 1;
        result.failures.push({
          plant_id: plant.id,
          external_plant_id: plant.external_plant_id,
          message: sanitizedMessage(error),
        });
        logger.error('HYXi alarm sync plant failed:', {
          plant_id: plant.id,
          external_plant_id: plant.external_plant_id,
          message: sanitizedMessage(error),
        });
      }
    }
    return result;
  };
}

/*
 * Integración en server/src/server.js (patrón existente):
 *   const runHyxiAlarmsSync = createScheduledSync({
 *     name: 'alarms', sync: createHyxiAlarmSync(), timeoutMs: HYXI_TASK_TIMEOUT_MS,
 *   });
 * junto a los demás syncs HYXi (mismo intervalo 5 min, mismo guard
 * single-flight). La falla del sync de alarmas solo se loguea: no afecta
 * a telemetría/energía porque no comparte writes.
 */
export const syncHyxiAlarms = createHyxiAlarmSync();
