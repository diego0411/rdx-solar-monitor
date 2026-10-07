import { listEnergyIntervalsRange } from '../repositories/energyIntervals.repository.js';
import { syncHyxiEnergyHistory } from './hyxiEnergyHistory.service.js';
import { syncGrowattEnergyHistory } from './growattEnergyHistory.service.js';

export const BACKFILL_MAX_DAYS = 7;

const NULL_OBSERVED_FIELDS = [
  'generation_kwh',
  'consumption_kwh',
  'grid_import_kwh',
  'grid_export_kwh',
];

function validCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Rango V1: fechas calendario válidas, start <= end, máximo 7 días
// inclusivos, todo estrictamente anterior al hoy local de la planta.
// No se acepta hoy (dato en curso, dueño el scheduler) ni futuro.
export function validateBackfillRange(input, todayLocal) {
  const startDate = input?.start_date;
  const endDate = input?.end_date;
  if (!validCalendarDate(startDate) || !validCalendarDate(endDate)) return null;
  if (endDate < startDate) return null;
  if (endDate >= todayLocal) return null;
  const dates = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    dates.push(date);
    if (dates.length > BACKFILL_MAX_DAYS) return null;
  }
  return dates;
}

// La planta debe poder sincronizarse ANTES de cualquier llamada al
// fabricante: existe, activa, provider soportado e identificadores
// externos que ese provider exige (HYXi: external_plant_id; Growatt
// resuelve dispositivos por planta y no exige external_plant_id aquí).
export function checkPlantSyncable(plant) {
  if (!plant || plant.active !== true) {
    return { status: 422, error: 'La planta no está activa para backfill' };
  }
  if (plant.provider === 'hyxi') {
    if (!plant.external_plant_id) {
      return { status: 422, error: 'La planta HYXi no tiene identificador externo' };
    }
    return { ok: true };
  }
  if (plant.provider === 'growatt') return { ok: true };
  return { status: 422, error: 'Proveedor no soportado para backfill' };
}

export function countNullFields(rows) {
  let total = 0;
  for (const row of rows) {
    for (const field of NULL_OBSERVED_FIELDS) {
      if (row[field] === null || row[field] === undefined) total += 1;
    }
  }
  return total;
}

export async function observeBackfillDay(plantId, date) {
  const rows = await listEnergyIntervalsRange(plantId, 1, date, addDays(date, 1));
  return { rows: rows.length, nullFields: countNullFields(rows) };
}

function sanitizedDayError(error) {
  return {
    code: error?.statusCode ?? error?.code ?? 'BACKFILL_DAY_FAILED',
    message: 'No se pudo sincronizar el día',
  };
}

function mapHyxiDay(result) {
  if (!result || typeof result !== 'object') {
    return { status: 'failed', error: { code: 'BACKFILL_DAY_FAILED', message: 'No se pudo sincronizar el día' } };
  }
  if (result.failed > 0) return { status: 'failed', details: { fetched: result.fetched ?? 0 } };
  if ((result.fetched ?? 0) === 0 && (result.upserted ?? 0) === 0) return { status: 'no_manufacturer_data' };
  const day = { status: 'completed' };
  if (result.merge && typeof result.merge === 'object') day.details = { merge: result.merge };
  return day;
}

function mapGrowattDay(result) {
  if (!result || typeof result !== 'object') {
    return { status: 'failed', error: { code: 'BACKFILL_DAY_FAILED', message: 'No se pudo sincronizar el día' } };
  }
  if (result.failed > 0) return { status: 'failed', details: { fetched: result.fetched ?? 0 } };
  if (result.skipped_degraded === true) {
    return {
      status: 'skipped_degraded',
      details: {
        devices: result.devices ?? null,
        fetched: result.fetched ?? 0,
        power_history_synced: result.power_history_synced ?? false,
        meter_used: result.meter_used ?? false,
      },
    };
  }
  if ((result.fetched ?? 0) === 0 && (result.upserted ?? 0) === 0) return { status: 'no_manufacturer_data' };
  return { status: 'completed' };
}

// Orquestación V1: secuencial (concurrencia 1) en orden start→end.
// Procesa TODOS los días del rango sin inferir completitud: la
// granularidad del proveedor no es contractual. Sin locks ni estado:
// la idempotencia la dan los merges/upserts existentes.
export async function runEnergyBackfill({
  plant, dates, observeDay, syncHyxiDay, syncGrowattDay,
}) {
  const days = [];
  let aborted = false;
  for (const date of dates) {
    const before = await observeDay(plant.id, date);
    let day;
    try {
      const result = plant.provider === 'hyxi'
        ? await syncHyxiDay(plant.external_plant_id, date)
        : await syncGrowattDay(plant, date);
      day = plant.provider === 'hyxi' ? mapHyxiDay(result) : mapGrowattDay(result);
    } catch (error) {
      if (error?.frequentAccess === true) {
        // Rate limit real Growatt: abortar el rango, sin retry ni sleep.
        day = {
          status: 'failed',
          error: { code: 'FREQUENTLY_ACCESS', message: 'Límite del fabricante; rango abortado' },
        };
        aborted = true;
      } else {
        day = { status: 'failed', error: sanitizedDayError(error) };
      }
    }
    const after = await observeDay(plant.id, date);
    days.push({
      date,
      status: day.status,
      rows_before: before.rows,
      rows_after: after.rows,
      null_fields_before: before.nullFields,
      null_fields_after: after.nullFields,
      ...(day.error ? { error: day.error } : {}),
      ...(day.details ? { details: day.details } : {}),
    });
    if (aborted) break;
  }
  const summary = {
    requested: dates.length,
    completed: 0,
    no_manufacturer_data: 0,
    skipped_degraded: 0,
    failed: 0,
  };
  for (const day of days) {
    if (Object.hasOwn(summary, day.status)) summary[day.status] += 1;
  }
  return {
    plant_id: plant.id,
    provider: plant.provider,
    range: { start_date: dates[0], end_date: dates[dates.length - 1] },
    days,
    summary,
    ...(aborted ? { aborted: true } : {}),
  };
}

export function defaultBackfillDeps() {
  return {
    observeDay: observeBackfillDay,
    syncHyxiDay: (externalPlantId, date) => syncHyxiEnergyHistory(externalPlantId, 1, date),
    syncGrowattDay: (plant, date) => syncGrowattEnergyHistory(plant, date),
  };
}
