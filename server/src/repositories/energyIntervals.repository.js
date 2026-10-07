import { supabase } from '../config/supabase.js';
import { localDateKey } from '../utils/timezone.js';

// La serie pública conserva los campos kWh y extrae únicamente provenance
// conocida desde raw_data; el payload crudo nunca sale del repositorio.
const ENERGY_SERIES_COLUMNS = 'interval_start, timezone, generation_kwh, consumption_kwh, grid_import_kwh, grid_export_kwh';
const ENERGY_INTRADAY_COLUMNS = `${ENERGY_SERIES_COLUMNS}, raw_data`;
// Rango compartido con economía: calculatePlantEconomics además lee
// row.raw_data?.coverage, por lo que raw_data debe conservarse aquí.
// data_observation también requiere provider y updated_at (solo lectura,
// sin cambiar comportamiento de los demás consumidores del rango).
const ENERGY_RANGE_COLUMNS = `${ENERGY_SERIES_COLUMNS}, provider, updated_at, raw_data`;

function counterProvenance(value) {
  return value?.source === 'growatt_meter' && typeof value.first_daily_counter === 'boolean'
    ? { source: 'growatt_meter', first_daily_counter: value.first_daily_counter }
    : null;
}

function consumptionProvenance(value) {
  return value?.source === 'derived' && typeof value.depends_on_first_daily_counter === 'boolean'
    ? { source: 'derived', depends_on_first_daily_counter: value.depends_on_first_daily_counter }
    : null;
}

export function projectEnergySeriesRow(row) {
  const stored = row?.raw_data?.energy_provenance;
  const projected = stored && typeof stored === 'object' ? {
    grid_import_kwh: counterProvenance(stored.grid_import_kwh),
    grid_export_kwh: counterProvenance(stored.grid_export_kwh),
    consumption_kwh: consumptionProvenance(stored.consumption_kwh),
  } : null;
  const energyProvenance = projected && Object.values(projected).some(value => value !== null)
    ? projected : null;
  const { raw_data, ...series } = row;
  return { ...series, energy_provenance: energyProvenance };
}

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
    const { data, error } = await supabase.from('energy_intervals').select(ENERGY_INTRADAY_COLUMNS)
      .eq('plant_id', plantId).eq('interval_type', timeType)
      .gte('interval_start', lower).lt('interval_start', upper)
      .order('interval_start', { ascending: true }).range(offset, offset + 999);
    if (error) throw new Error('No se pudo consultar el histórico energético');
    for (const row of data) {
      const date = localDateKey(row.interval_start, row.timezone);
      if (date !== null && date.slice(0, prefixLength) === prefix) {
        rows.push(projectEnergySeriesRow(row));
      }
    }
    if (data.length < 1000) return rows;
  }
}

export async function listEnergyIntervalsRange(plantId, timeType, startDate, endDate) {
  const lower = new Date(Date.parse(`${startDate}T00:00:00.000Z`) - 86400000).toISOString();
  const upper = new Date(Date.parse(`${endDate}T00:00:00.000Z`) + 86400000).toISOString();
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from('energy_intervals').select(ENERGY_RANGE_COLUMNS)
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
