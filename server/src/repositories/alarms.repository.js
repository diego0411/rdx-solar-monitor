import { supabase } from '../config/supabase.js';

/*
 * Historial normalizado de alarmas (Fase 1: operaciones atómicas).
 *
 * Cada fila es un EPISODIO: la unicidad la garantiza la BD con índices
 * UNIQUE PARCIALES sobre status = 'active' (ver 034_alarms.sql), así que
 * nunca puede haber dos episodios activos con la misma identidad lógica
 * aunque dos pollers inserten a la vez. Este repositorio NO decide cuándo
 * resolver: solo expone las operaciones que la Fase 2 necesitará.
 */

function identityQuery({ provider, deviceId = null, plantId = null, alarmCode, externalAlarmId = null }) {
  let query = supabase.from('alarms').select('*')
    .eq('provider', provider)
    .eq('status', 'active')
    .eq('alarm_code', alarmCode);
  if (deviceId) query = query.eq('device_id', deviceId);
  else query = query.is('device_id', null).eq('plant_id', plantId);
  query = externalAlarmId ? query.eq('external_alarm_id', externalAlarmId) : query.is('external_alarm_id', null);
  return query;
}

export async function findActiveAlarm(identity) {
  const { data, error } = await identityQuery(identity).maybeSingle();
  if (error) throw new Error('No se pudo consultar la alarma activa');
  return data ?? null;
}

/*
 * Lookup por evento del fabricante en CUALQUIER estado (HYXi: identidad
 * del episodio = external_alarm_id = String(item.id)). Con 035 aplicada,
 * (provider, external_alarm_id) no-null es UNIQUE: este lookup + manejo
 * 23505 en los create hacen el flujo idempotente ante concurrencia.
 */
export async function findAlarmByExternalId(provider, externalAlarmId) {
  if (!provider || !externalAlarmId) return null;
  const { data, error } = await supabase.from('alarms').select('*')
    .eq('provider', provider)
    .eq('external_alarm_id', externalAlarmId)
    .maybeSingle();
  if (error) throw new Error('No se pudo consultar la alarma por ID externo');
  return data ?? null;
}

export async function createAlarmEpisode({
  plantId,
  deviceId = null,
  provider,
  externalAlarmId = null,
  alarmCode,
  title,
  description = null,
  severity = null,
  startedAt = null,
  firstSeenAt = null,
  lastSeenAt = null,
  rawPayload = null,
}) {
  if (!plantId) throw new Error('La alarma requiere plant_id');
  if (!alarmCode) throw new Error('La alarma requiere alarm_code');
  if (!title) throw new Error('La alarma requiere title');
  const now = new Date().toISOString();
  const firstSeen = firstSeenAt ?? now;
  const lastSeen = lastSeenAt ?? firstSeen;
  if (Date.parse(lastSeen) < Date.parse(firstSeen)) {
    throw new Error('last_seen_at no puede ser anterior a first_seen_at');
  }
  const values = {
    plant_id: plantId,
    device_id: deviceId,
    provider,
    external_alarm_id: externalAlarmId,
    alarm_code: alarmCode,
    title,
    description,
    severity,
    status: 'active',
    started_at: startedAt,
    resolved_at: null,
    first_seen_at: firstSeen,
    last_seen_at: lastSeen,
    raw_payload: rawPayload,
    updated_at: now,
  };
  const { data, error } = await supabase.from('alarms').insert(values).select().single();
  if (!error) return { alarm: data, created: true };
  // 23505: otro proceso creó el episodio concurrente. Puede ser por el
  // UNIQUE PARCIAL de activo (misma identidad lógica) o, con 035 aplicada,
  // por alarms_provider_external_uidx (mismo provider/external_alarm_id en
  // cualquier estado: el otro proceso pudo importarlo ya resuelto).
  // Releer por ID externo cubre ambos casos sin retry de INSERT.
  if (error.code === '23505') {
    const existing = await findActiveAlarm({
      provider, deviceId, plantId, alarmCode, externalAlarmId,
    });
    if (existing) return { alarm: existing, created: false };
    if (externalAlarmId) {
      const byExternalId = await findAlarmByExternalId(provider, externalAlarmId);
      if (byExternalId) return { alarm: byExternalId, created: false };
    }
  }
  throw new Error('No se pudo crear el episodio de alarma');
}

export async function touchActiveAlarm(id, { lastSeenAt = null, rawPayload = undefined } = {}) {
  const now = new Date().toISOString();
  const values = { last_seen_at: lastSeenAt ?? now, updated_at: now };
  if (rawPayload !== undefined) values.raw_payload = rawPayload;
  const { data, error } = await supabase.from('alarms').update(values)
    .eq('id', id).eq('status', 'active').select().maybeSingle();
  if (error) throw new Error('No se pudo actualizar la alarma activa');
  return data ?? null;
}

/*
 * Re-observación de un episodio en CUALQUIER estado (HYXi: un episodio
 * ya resuelto puede reaparecer en pageData). Actualiza por PK: sin
 * condición de status, sin conflicto posible. Solo last_seen_at +
 * raw_payload: jamás cambia status/resolved_at (eso lo decide
 * resolveAlarm con endTime del fabricante).
 */
export async function touchAlarmObservation(id, { lastSeenAt = null, rawPayload = undefined } = {}) {
  const now = new Date().toISOString();
  const values = { last_seen_at: lastSeenAt ?? now, updated_at: now };
  if (rawPayload !== undefined) values.raw_payload = rawPayload;
  const { data, error } = await supabase.from('alarms').update(values)
    .eq('id', id).select().maybeSingle();
  if (error) throw new Error('No se pudo actualizar la observación de la alarma');
  return data ?? null;
}

/*
 * Creación directa de episodio RESUELTO (HYXi: primer poll ya trae
 * endTime). Un solo INSERT con status resolved + resolved_at (los CHECK
 * de 034 lo exigen juntos). Con 035 aplicada, un 23505 por
 * alarms_provider_external_uidx significa que otro proceso importó el
 * mismo evento concurrente: se relee por ID externo y se devuelve el
 * existente (sin retry de INSERT). Si 23505 ocurre y la fila no aparece,
 * se falla explícitamente. Cualquier otro error propaga.
 */
export async function createResolvedAlarmEpisode({
  plantId,
  deviceId = null,
  provider,
  externalAlarmId = null,
  alarmCode,
  title,
  description = null,
  severity = null,
  startedAt = null,
  resolvedAt,
  firstSeenAt = null,
  lastSeenAt = null,
  rawPayload = null,
}) {
  if (!plantId) throw new Error('La alarma requiere plant_id');
  if (!alarmCode) throw new Error('La alarma requiere alarm_code');
  if (!title) throw new Error('La alarma requiere title');
  if (!resolvedAt) throw new Error('La alarma resuelta requiere resolved_at');
  const now = new Date().toISOString();
  const firstSeen = firstSeenAt ?? now;
  const lastSeen = lastSeenAt ?? firstSeen;
  if (Date.parse(lastSeen) < Date.parse(firstSeen)) {
    throw new Error('last_seen_at no puede ser anterior a first_seen_at');
  }
  const values = {
    plant_id: plantId,
    device_id: deviceId,
    provider,
    external_alarm_id: externalAlarmId,
    alarm_code: alarmCode,
    title,
    description,
    severity,
    status: 'resolved',
    started_at: startedAt,
    resolved_at: resolvedAt,
    first_seen_at: firstSeen,
    last_seen_at: lastSeen,
    raw_payload: rawPayload,
    updated_at: now,
  };
  const { data, error } = await supabase.from('alarms').insert(values).select().single();
  if (!error) return { alarm: data, created: true };
  if (error.code === '23505' && externalAlarmId) {
    const existing = await findAlarmByExternalId(provider, externalAlarmId);
    if (existing) return { alarm: existing, created: false };
    throw new Error('No se pudo crear el episodio de alarma resuelto');
  }
  throw new Error('No se pudo crear el episodio de alarma resuelto');
}

export async function resolveAlarm(id, { resolvedAt = null } = {}) {
  const now = new Date().toISOString();
  const values = { status: 'resolved', resolved_at: resolvedAt ?? now, updated_at: now };
  const { data, error } = await supabase.from('alarms').update(values)
    .eq('id', id).eq('status', 'active').select().maybeSingle();
  if (error) throw new Error('No se pudo resolver la alarma');
  return data ?? null;
}

export async function listAlarms({
  plantIds = null,
  provider = null,
  status = null,
  deviceId = null,
  limit = 100,
  offset = 0,
} = {}) {
  if (plantIds !== null && plantIds !== undefined && plantIds.size === 0) return [];
  let query = supabase.from('alarms').select('*')
    .order('first_seen_at', { ascending: false })
    .order('id', { ascending: false });
  if (plantIds !== null && plantIds !== undefined) query = query.in('plant_id', [...plantIds]);
  if (provider) query = query.eq('provider', provider);
  if (status) query = query.eq('status', status);
  if (deviceId) query = query.eq('device_id', deviceId);
  const { data, error } = await query.range(offset, offset + limit - 1);
  if (error) throw new Error('No se pudieron consultar las alarmas');
  return data;
}

export async function getAlarmById(id, plantIds = null) {
  if (plantIds !== null && plantIds !== undefined && plantIds.size === 0) return null;
  let query = supabase.from('alarms').select('*').eq('id', id);
  if (plantIds !== null && plantIds !== undefined) query = query.in('plant_id', [...plantIds]);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error('No se pudo consultar la alarma');
  return data ?? null;
}

/*
 * Lectura para la API normalizada (Fase API): una sola consulta con joins
 * embebidos (sin N+1) + count exacto para paginación. El search cubre solo
 * alarm_code/title/description: PostgREST no permite or() sobre tablas
 * embebidas (PGRST100), así que plant/device name quedan fuera del search
 * sin una migración con índices trigram/RPC.
 */
const ALARM_WITH_RELATIONS = '*, plant:plants(id,name), device:devices(id,name,serial_number,device_type)';

function escapeIlikeTerm(value) {
  return String(value).replace(/[\\%_]/g, char => `\\${char}`).replace(/[,()]/g, ' ');
}

function applyAlarmPageFilters(query, filters = {}) {
  const { provider, status, severity, plantIds, plantId, deviceId, dateFrom, dateTo, search } = filters;
  if (plantIds !== null && plantIds !== undefined) query = query.in('plant_id', [...plantIds]);
  if (provider) query = query.eq('provider', provider);
  if (status) query = query.eq('status', status);
  if (severity) query = query.eq('severity', severity);
  if (plantId) query = query.eq('plant_id', plantId);
  if (deviceId) query = query.eq('device_id', deviceId);
  if (dateFrom) query = query.gte('first_seen_at', dateFrom);
  if (dateTo) query = query.lte('first_seen_at', dateTo);
  if (search) {
    const term = `%${escapeIlikeTerm(search)}%`;
    query = query.or(`alarm_code.ilike.${term},title.ilike.${term},description.ilike.${term}`);
  }
  return query;
}

export async function listAlarmsPage({
  plantIds = null,
  provider = null,
  status = null,
  severity = null,
  plantId = null,
  deviceId = null,
  dateFrom = null,
  dateTo = null,
  search = null,
  page = 1,
  pageSize = 20,
} = {}) {
  if (plantIds !== null && plantIds !== undefined && plantIds.size === 0) return { alarms: [], total: 0 };
  let query = supabase.from('alarms').select(ALARM_WITH_RELATIONS, { count: 'exact' })
    .order('status', { ascending: true })
    .order('first_seen_at', { ascending: false })
    .order('id', { ascending: false });
  query = applyAlarmPageFilters(query, {
    provider, status, severity, plantIds, plantId, deviceId, dateFrom, dateTo, search,
  });
  const offset = (page - 1) * pageSize;
  const { data, error, count } = await query.range(offset, offset + pageSize - 1);
  if (error) throw new Error('No se pudieron consultar las alarmas');
  return { alarms: data, total: count ?? 0 };
}

export async function getAlarmDetail(id, plantIds = null) {
  if (plantIds !== null && plantIds !== undefined && plantIds.size === 0) return null;
  let query = supabase.from('alarms').select(ALARM_WITH_RELATIONS).eq('id', id);
  if (plantIds !== null && plantIds !== undefined) query = query.in('plant_id', [...plantIds]);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error('No se pudo consultar la alarma');
  return data ?? null;
}

export async function getAlarmsSummary({ plantIds = null, resolvedSince = null } = {}) {
  if (plantIds !== null && plantIds !== undefined && plantIds.size === 0) {
    return { active: 0, critical: 0, warning: 0, resolved_7d: 0, by_provider: { hyxi: 0, growatt: 0 } };
  }
  const scoped = (query) => (
    plantIds !== null && plantIds !== undefined ? query.in('plant_id', [...plantIds]) : query
  );
  const specs = [
    ['active', scoped(supabase.from('alarms').select('id', { count: 'exact', head: true }).eq('status', 'active'))],
    ['critical', scoped(supabase.from('alarms').select('id', { count: 'exact', head: true }).eq('status', 'active').eq('severity', 'critical'))],
    ['warning', scoped(supabase.from('alarms').select('id', { count: 'exact', head: true }).eq('status', 'active').eq('severity', 'warning'))],
    ['resolved_7d', scoped(supabase.from('alarms').select('id', { count: 'exact', head: true }).eq('status', 'resolved').gte('resolved_at', resolvedSince))],
    // Desglose para el dashboard (una sola petición en vez de dos
    // listAlarms?pageSize=1): solo activas, mismo alcance, sin filas.
    ['by_provider.hyxi', scoped(supabase.from('alarms').select('id', { count: 'exact', head: true }).eq('status', 'active').eq('provider', 'hyxi'))],
    ['by_provider.growatt', scoped(supabase.from('alarms').select('id', { count: 'exact', head: true }).eq('status', 'active').eq('provider', 'growatt'))],
  ];
  const summary = { by_provider: {} };
  for (const [key, query] of specs) {
    const { count, error } = await query;
    if (error) throw new Error('No se pudo consultar el resumen de alarmas');
    if (key.startsWith('by_provider.')) {
      summary.by_provider[key.slice('by_provider.'.length)] = count ?? 0;
    } else {
      summary[key] = count ?? 0;
    }
  }
  return summary;
}
