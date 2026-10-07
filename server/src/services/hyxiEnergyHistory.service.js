import { HyxiProvider } from '../providers/hyxi/HyxiProvider.js';
import { resolveHyxiPlant, upsertEnergyIntervals } from '../repositories/energyIntervals.repository.js';
import { listEnergyIntervalsRange } from '../repositories/energyIntervals.repository.js';
import { listPlantPowerIntervals } from '../repositories/plantPowerIntervals.repository.js';
import { localDateKey } from '../utils/timezone.js';
import { hyxiHistoryStartTime } from './historyPeriods.js';

const provider = new HyxiProvider();

const derivedFields = {
  generation_power_w: 'generation_kwh',
  consumption_power_w: 'consumption_kwh',
  grid_import_power_w: 'grid_import_kwh',
  grid_export_power_w: 'grid_export_kwh',
};

function energyFromPower(value, intervalHours) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const power = Number(value);
  return Number.isFinite(power) ? power * intervalHours / 1000 : null;
}

async function deriveFromPowerHistory(plantId, startTime) {
  const powerRows = await listPlantPowerIntervals(plantId, startTime);
  const points = [];
  for (let index = 0; index < powerRows.length - 1; index += 1) {
    const current = powerRows[index];
    const next = powerRows[index + 1];
    const intervalMs = Date.parse(next.interval_start) - Date.parse(current.interval_start);
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) continue;
    const intervalHours = intervalMs / 3600000;
    points.push({
      timestamp: current.interval_start,
      timezone: current.timezone,
      ...Object.fromEntries(Object.entries(derivedFields).map(([powerField, energyField]) => [
        energyField, energyFromPower(current[powerField], intervalHours),
      ])),
      battery_charge_kwh: null,
      battery_discharge_kwh: null,
      raw_data: {
        derived_from: 'plant_power_intervals',
        interval_end: next.interval_start,
        interval_hours: intervalHours,
        power_interval_id: current.id,
      },
    });
  }
  return points;
}

// Anti-degradación HYXi (merge por campo sobre la clave UNIQUE
// plant_id + interval_type + interval_start):
// - NULL candidato nunca borra un valor existente (relleno solo a mejor).
// - Valor candidato directo y válido actualiza (nueva observación).
// - Candidato DERIVADO (fallback desde power) solo rellena NULLs: una
//   estimación nunca reemplaza una medición directa ya almacenada.
//   Directo vs derivado se distingue por raw_data.derived_from.
// - Sin cambios: se conserva la fila existente intacta (idempotente,
//   sin churn de updated_at). Nunca NULL→0.
const HYXI_MERGE_FIELDS = [
  'generation_kwh',
  'consumption_kwh',
  'grid_import_kwh',
  'grid_export_kwh',
  'battery_charge_kwh',
  'battery_discharge_kwh',
];

const DERIVED_FROM_POWER = 'plant_power_intervals';

function isEmpty(value) {
  return value === null || value === undefined;
}

function isDerivedRow(row) {
  return row?.raw_data?.derived_from === DERIVED_FROM_POWER;
}

export function mergeHyxiEnergyRows(existingRows, candidateRows) {
  const existingByInstant = new Map();
  for (const row of existingRows) {
    const instant = Date.parse(row.interval_start);
    if (Number.isFinite(instant) && !existingByInstant.has(instant)) {
      existingByInstant.set(instant, row);
    }
  }
  const stats = { inserted: 0, filled: 0, updated: 0, preserved: 0, unchanged: 0 };
  const rows = candidateRows.map(candidate => {
    const instant = Date.parse(candidate.interval_start);
    const existing = Number.isFinite(instant) ? existingByInstant.get(instant) : undefined;
    if (!existing) {
      stats.inserted += 1;
      return candidate;
    }
    const candidateDerived = isDerivedRow(candidate);
    const merged = { ...candidate };
    let contributed = false;
    for (const field of HYXI_MERGE_FIELDS) {
      if (isEmpty(candidate[field])) {
        if (!isEmpty(existing[field])) stats.preserved += 1;
        merged[field] = existing[field] ?? null;
      } else if (isEmpty(existing[field])) {
        stats.filled += 1;
        contributed = true;
      } else if (candidateDerived) {
        // Estimación frente a medición: se conserva la existente.
        stats.preserved += 1;
        merged[field] = existing[field];
      } else if (candidate[field] !== existing[field]) {
        stats.updated += 1;
        contributed = true;
      }
    }
    if (!contributed) {
      // Reejecución idéntica u observación ya reflejada: conservar todo,
      // incluido raw_data y updated_at existentes.
      stats.unchanged += 1;
      return existing;
    }
    // El candidato aportó valores: su raw_data es la evidencia nueva.
    // Si no trae raw_data, se conserva el existente.
    if (merged.raw_data === null || merged.raw_data === undefined) {
      merged.raw_data = existing.raw_data ?? null;
    }
    return merged;
  });
  return { rows, stats };
}

function candidateDateRange(candidateRows) {
  const days = [...new Set(candidateRows
    .map(row => localDateKey(row.interval_start, row.timezone))
    .filter(day => day !== null))].sort();
  if (!days.length) return null;
  const end = new Date(`${days[days.length - 1]}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: days[0], end: end.toISOString().slice(0, 10) };
}

export async function syncHyxiEnergyHistory(externalPlantId, timeType, startTime) {
  const plantId = await resolveHyxiPlant(externalPlantId);
  const providerStartTime = hyxiHistoryStartTime(timeType, startTime);
  const history = await provider.getPlantEnergyHistory(externalPlantId, timeType, providerStartTime);
  const hasEnergy = history.points.some(point => [
    point.generation_kwh,
    point.consumption_kwh,
    point.grid_import_kwh,
    point.grid_export_kwh,
  ].some(value => value !== null && value !== undefined));
  const points = !hasEnergy && timeType === 1
    ? await deriveFromPowerHistory(plantId, startTime)
    : history.points;
  const updatedAt = new Date().toISOString();
  const rows = points.map(point => ({
    plant_id: plantId,
    provider: 'hyxi',
    interval_type: timeType,
    interval_start: point.timestamp,
    timezone: point.timezone ?? history.timeZone,
    generation_kwh: point.generation_kwh,
    consumption_kwh: point.consumption_kwh,
    battery_charge_kwh: point.battery_charge_kwh,
    battery_discharge_kwh: point.battery_discharge_kwh,
    grid_import_kwh: point.grid_import_kwh,
    grid_export_kwh: point.grid_export_kwh,
    raw_data: point.raw_data,
    updated_at: updatedAt,
  }));
  const result = { fetched: rows.length, upserted: 0, failed: 0 };
  try {
    let toPersist = rows;
    let mergeStats = null;
    if (rows.length) {
      // Protección: solo se fusiona contra filas del mismo interval_type en
      // la ventana de fechas candidatas; el merge casa por instante exacto.
      const range = candidateDateRange(rows);
      const existing = range
        ? await listEnergyIntervalsRange(plantId, timeType, range.start, range.end)
        : [];
      const merged = mergeHyxiEnergyRows(existing, rows);
      toPersist = merged.rows;
      mergeStats = merged.stats;
    }
    await upsertEnergyIntervals(toPersist);
    result.upserted = toPersist.length;
    if (mergeStats) result.merge = mergeStats;
  } catch {
    result.failed = rows.length;
  }
  return result;
}
