import { withSyncLock } from './syncLock.js';
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

const ENERGY_FIELDS = Object.values(derivedFields);

export function energyFromPower(value, intervalHours) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const power = Number(value);
  if (!Number.isFinite(power)) return null;
  // Energía derivada nunca negativa: potencia instantánea con signo (válida
  // en power) integrada en negativo es energía inválida → ausencia (null).
  const energy = power * intervalHours / 1000;
  return energy >= 0 ? energy : null;
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

// H04-4: combina historia directa con derivada por instante y por campo.
// Un valor directo (incluido 0) nunca se sobrescribe; la derivación solo
// rellena campos NULL y agrega instantes ausentes del historial directo.
function combineDirectAndDerived(directPoints, derivedPoints) {
  const derivedByInstant = new Map();
  for (const point of derivedPoints) {
    const instant = Date.parse(point.timestamp);
    if (Number.isFinite(instant) && !derivedByInstant.has(instant)) {
      derivedByInstant.set(instant, point);
    }
  }
  const directInstants = new Set();
  const combined = directPoints.map(direct => {
    const instant = Date.parse(direct.timestamp);
    if (Number.isFinite(instant)) directInstants.add(instant);
    const derived = Number.isFinite(instant) ? derivedByInstant.get(instant) : undefined;
    if (!derived) return direct;
    const merged = { ...direct };
    let contributed = false;
    for (const field of ENERGY_FIELDS) {
      if (isEmpty(direct[field]) && !isEmpty(derived[field])) {
        merged[field] = derived[field];
        contributed = true;
      }
    }
    if (!contributed) return direct;
    // Procedencia: la fila conserva su evidencia del proveedor mientras quede
    // alguna medición directa; solo una fila sin ninguna adopta la de potencia.
    if (ENERGY_FIELDS.some(field => !isEmpty(direct[field]))) return merged;
    merged.raw_data = derived.raw_data;
    return merged;
  });
  for (const [instant, point] of derivedByInstant) {
    if (!directInstants.has(instant)) combined.push(point);
  }
  return combined;
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
  // Join the provider's normalized period; serialize all candidate windows for
  // this plant because returned rows can extend beyond the requested date.
  return withSyncLock(`hyxi:energy:${externalPlantId}:${timeType}:${hyxiHistoryStartTime(timeType, startTime)}`, () =>
    withSyncLock(`hyxi:energy-writes:${externalPlantId}`, () =>
      syncHyxiEnergyHistoryUnlocked(externalPlantId, timeType, startTime), { mode: 'queue' }),
  );
}

async function syncHyxiEnergyHistoryUnlocked(externalPlantId, timeType, startTime) {
  const plantId = await resolveHyxiPlant(externalPlantId);
  const providerStartTime = hyxiHistoryStartTime(timeType, startTime);
  const history = await provider.getPlantEnergyHistory(externalPlantId, timeType, providerStartTime);
  // H04-4: sin hasEnergy global a la ventana. El fallback se activa para
  // timeType 1 solo con huecos identificables (campos de energía NULL o
  // ventana vacía) y combina por instante y por campo: la medición directa
  // (incluido 0) siempre manda; la derivación solo rellena y agrega huecos.
  const directPoints = history.points;
  const energyGap = directPoints.length === 0
    || directPoints.some(point => ENERGY_FIELDS.some(field => isEmpty(point[field])));
  const points = energyGap && timeType === 1
    ? combineDirectAndDerived(directPoints, await deriveFromPowerHistory(plantId, startTime))
    : directPoints;
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
    let toPersist = [];
    let mergeStats = null;
    if (rows.length) {
      // Protección: solo se fusiona contra filas del mismo interval_type en
      // la ventana de fechas candidatas; el merge casa por instante exacto.
      const range = candidateDateRange(rows);
      const existing = range
        ? await listEnergyIntervalsRange(plantId, timeType, range.start, range.end)
        : [];
      const merged = mergeHyxiEnergyRows(existing, rows);
      mergeStats = merged.stats;
      // Las filas sin cambios son la referencia intacta a `existing`
      // (ver mergeHyxiEnergyRows: rama !contributed): vienen de
      // listEnergyIntervalsRange y NO traen plant_id ni interval_type
      // (columnas NOT NULL del upsert). Se excluyen: no requieren
      // escritura y romperían el upsert por conflicto.
      const existingByInstant = new Map();
      for (const row of existing) {
        const instant = Date.parse(row.interval_start);
        if (Number.isFinite(instant) && !existingByInstant.has(instant)) {
          existingByInstant.set(instant, row);
        }
      }
      toPersist = merged.rows.filter(
        row => row !== existingByInstant.get(Date.parse(row.interval_start)),
      );
    }
    if (toPersist.length) {
      await upsertEnergyIntervals(toPersist);
      result.upserted = toPersist.length;
    }
    if (mergeStats) result.merge = mergeStats;
  } catch {
    result.failed = rows.length;
  }
  return result;
}
