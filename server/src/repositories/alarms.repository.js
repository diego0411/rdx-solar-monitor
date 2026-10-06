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
  // Conflicto con el UNIQUE PARCIAL de episodio activo: otro proceso ya
  // creó el episodio. Devolver el existente de forma determinista en vez
  // de duplicar (el patrón SELECT→INSERT tendría carrera).
  if (error.code === '23505') {
    const existing = await findActiveAlarm({
      provider, deviceId, plantId, alarmCode, externalAlarmId,
    });
    if (existing) return { alarm: existing, created: false };
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
