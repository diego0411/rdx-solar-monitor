import { supabase } from '../config/supabase.js';
import { localDateKey } from '../utils/timezone.js';

export async function resolveHyxiPlant(externalPlantId) {
  const { data, error } = await supabase.from('plants').select('id')
    .eq('provider', 'hyxi').eq('external_plant_id', externalPlantId).limit(2);
  if (error) throw new Error('No se pudo consultar la planta HYXi');
  if (data.length !== 1) {
    const failure = new Error(data.length ? 'La planta HYXi es ambigua' : 'Planta HYXi no encontrada');
    failure.statusCode = data.length ? 409 : 404;
    throw failure;
  }
  return data[0].id;
}

export async function upsertEnergyIntervals(rows) {
  if (!rows.length) return;
  const { error } = await supabase.from('energy_intervals').upsert(rows, {
    onConflict: 'plant_id,interval_type,interval_start',
  });
  if (error) throw new Error('No se pudo guardar el histórico energético');
}

export async function listEnergyIntervals(plantId, timeType, startTime) {
  const start = new Date(`${startTime}T00:00:00.000Z`);
  if (timeType === 2) start.setUTCDate(1);
  if (timeType === 3) start.setUTCMonth(0, 1);
  const end = new Date(start);
  if (timeType === 1) end.setUTCDate(end.getUTCDate() + 1);
  if (timeType === 2) end.setUTCMonth(end.getUTCMonth() + 1);
  if (timeType === 3) end.setUTCFullYear(end.getUTCFullYear() + 1);
  // Include timezone offsets, then select the requested calendar period locally.
  const lower = new Date(start.getTime() - 86400000).toISOString();
  const upper = new Date(end.getTime() + 86400000).toISOString();
  const prefixLength = timeType === 1 ? 10 : timeType === 2 ? 7 : 4;
  const prefix = startTime.slice(0, prefixLength);
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from('energy_intervals').select('*')
      .eq('plant_id', plantId).eq('interval_type', timeType)
      .gte('interval_start', lower).lt('interval_start', upper)
      .order('interval_start', { ascending: true }).range(offset, offset + 999);
    if (error) throw new Error('No se pudo consultar el histórico energético');
    for (const row of data) {
      const date = localDateKey(row.interval_start, row.timezone);
      if (date !== null && date.slice(0, prefixLength) === prefix) rows.push(row);
    }
    if (data.length < 1000) return rows;
  }
}

export async function listEnergyIntervalsRange(plantId, timeType, startDate, endDate) {
  const lower = new Date(Date.parse(`${startDate}T00:00:00.000Z`) - 86400000).toISOString();
  const upper = new Date(Date.parse(`${endDate}T00:00:00.000Z`) + 86400000).toISOString();
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from('energy_intervals').select('*')
      .eq('plant_id', plantId).eq('interval_type', timeType)
      .gte('interval_start', lower).lt('interval_start', upper)
      .order('interval_start', { ascending: true }).range(offset, offset + 999);
    if (error) throw new Error('No se pudo consultar el histórico energético');
    for (const row of data) {
      const date = localDateKey(row.interval_start, row.timezone);
      if (date !== null && date >= startDate && date < endDate) rows.push(row);
    }
    if (data.length < 1000) return rows;
  }
}
