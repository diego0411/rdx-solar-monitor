import { isGrowattFault } from '../providers/growatt/growattStates.js';
import {
  createAlarmEpisode,
  findActiveAlarm,
  listAlarms,
  resolveAlarm,
  touchActiveAlarm,
} from '../repositories/alarms.repository.js';

/*
 * Episodios Growatt persistentes (Fase 2).
 *
 * Fuente ÚNICA: el snapshot queryLastData que syncGrowattLatest ya obtuvo
 * y persistió en device_latest_data. Este servicio NO llama al fabricante.
 *
 * Severidad DERIVADA POR RDX (Growatt no entrega severidad oficial):
 * FAULT -> critical, WARN -> warning, STATUS:FAULT -> critical.
 *
 * Resolución por ausencia INFERIDA POR RDX: un episodio activo se cierra
 * cuando un snapshot NUEVO y VÁLIDO del mismo dispositivo ya no contiene
 * su identidad. Nunca se resuelve por error API, timeout, rate limit,
 * scheduler dormido, snapshot ausente o collected_at inválido.
 *
 * Snapshot repetido: si el collected_at no avanza respecto a lo ya
 * procesado, se ignora por completo (ni touch ni resolve), porque es la
 * misma medición reconsultada, no telemetría nueva. La marca de "ya
 * procesado" viaja en raw_payload._rdx.collected_at para no requerir
 * columnas nuevas (034 congelada).
 */

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function usableText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.toLowerCase() === 'unknown') return null;
  return text;
}

function validTimestamp(value) {
  if (typeof value !== 'string' || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function extractGrowattAlarmIdentities(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const identities = [];
  const faultType = positiveNumber(raw.faultType);
  if (faultType > 0) {
    identities.push({
      kind: 'fault',
      code: `FAULT:${faultType}`,
      title: usableText(raw.errorText) ?? `Growatt fault ${faultType}`,
      severity: 'critical',
    });
  }
  const warnCode = positiveNumber(raw.warnCode);
  if (warnCode > 0) {
    identities.push({
      kind: 'warning',
      code: `WARN:${warnCode}`,
      title: usableText(raw.warnText) ?? `Growatt warning ${warnCode}`,
      severity: 'warning',
    });
  }
  // status 3/fault sin código: identidad fallback estable, sin inventar
  // código del fabricante. sysFaultWord/BMS/BDC/newWarnCode quedan solo
  // en raw_payload: sin semántica documentada no generan alarmas propias.
  if (identities.length === 0 && isGrowattFault(raw)) {
    identities.push({
      kind: 'fault',
      code: 'STATUS:FAULT',
      title: usableText(raw.statusText) ?? usableText(raw.errorText) ?? 'Growatt fault',
      severity: 'critical',
    });
  }
  return identities;
}

function envelope(raw, collectedAt, observedAt) {
  return { ...raw, _rdx: { collected_at: collectedAt, observed_at: observedAt } };
}

function lastProcessedCollectedAt(alarms) {
  let latest = null;
  for (const alarm of alarms ?? []) {
    const marker = alarm?.raw_payload?._rdx?.collected_at;
    if (typeof marker === 'string' && (latest === null || marker > latest)) latest = marker;
  }
  return latest;
}

export async function syncGrowattAlarmSnapshot({
  deviceId,
  plantId,
  raw,
  collectedAt = null,
  observedAt = null,
} = {}) {
  const observed = validTimestamp(observedAt) ?? new Date().toISOString();
  if (!deviceId || !plantId || !raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { processed: false, reason: 'no-snapshot', created: [], touched: [], resolved: [] };
  }
  const collected = validTimestamp(collectedAt);
  const identities = extractGrowattAlarmIdentities(raw);
  const existing = await listAlarms({ deviceId });
  const actives = existing.filter(alarm => alarm.status === 'active');
  const lastProcessed = lastProcessedCollectedAt(existing);
  if (collected && lastProcessed && collected <= lastProcessed) {
    return { processed: false, reason: 'duplicate-snapshot', created: [], touched: [], resolved: [] };
  }
  const created = [];
  const touched = [];
  for (const identity of identities) {
    const active = await findActiveAlarm({
      provider: 'growatt', deviceId, plantId, alarmCode: identity.code,
    });
    if (active) {
      // Marcador monotónico: un touch con collected_at NULL (snapshot sin
      // tiempo válido) jamás retrocede la marca ya registrada; si lo hiciera,
      // un snapshot viejo posterior calcularía mal "último procesado" y
      // podría resolver con datos desactualizados.
      const prevMarker = validTimestamp(active.raw_payload?._rdx?.collected_at ?? null);
      const next = await touchActiveAlarm(active.id, {
        lastSeenAt: observed, rawPayload: envelope(raw, collected ?? prevMarker, observed),
      });
      if (next) touched.push(next);
      continue;
    }
    const { alarm } = await createAlarmEpisode({
      plantId,
      deviceId,
      provider: 'growatt',
      alarmCode: identity.code,
      title: identity.title,
      description: null,
      severity: identity.severity,
      // Growatt no entrega inicio real del episodio: started_at NULL y
      // first_seen_at porta el collected_at del snapshot cuando es válido.
      startedAt: null,
      firstSeenAt: collected ?? observed,
      lastSeenAt: observed,
      rawPayload: envelope(raw, collected, observed),
    });
    created.push(alarm);
  }
  const resolved = [];
  // Solo un snapshot válido y nuevo habilita resolución por ausencia.
  if (collected) {
    const present = new Set(identities.map(identity => identity.code));
    for (const alarm of actives) {
      if (present.has(alarm.alarm_code)) continue;
      const closed = await resolveAlarm(alarm.id, { resolvedAt: collected });
      if (closed) resolved.push(closed);
    }
  }
  return { processed: true, reason: collected ? 'snapshot' : 'snapshot-no-resolve', created, touched, resolved };
}
