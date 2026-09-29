import { listActiveGrowattMinDevicesByPlant, listActiveGrowattMeterByPlant } from '../repositories/devices.repository.js';
import { listEnergyIntervalsRange, upsertEnergyIntervals } from '../repositories/energyIntervals.repository.js';
import { listPlantPowerIntervals } from '../repositories/plantPowerIntervals.repository.js';
import { syncGrowattPowerHistory } from './growattPowerHistory.service.js';
import { GrowattProvider } from '../providers/growatt/GrowattProvider.js';
import { parseGrowattTimestamp } from '../providers/growatt/growattStates.js';
import { localDateKey } from '../utils/timezone.js';
import { aggregateHistory, periodRange } from './historyPeriods.js';

const meterProvider = new GrowattProvider();

const meterCumulativeFields = {
  positiveActiveTodayEnergy: 'grid_import_kwh',
  reverseActiveTodayEnergy: 'grid_export_kwh',
};

// Ventana de asociación MIN↔meter: p50 real 5-9 s, cobertura 99-100%
// dentro de ±150 s (Jorge 90% por huecos; esos van a filas extra).
const METER_ALIGN_WINDOW_MS = 150000;
// Un throttle por datalogger evita ráfagas contra meter_data (límite
// documentado 1 llamada/5 min) cuando el sync se dispara concurrente;
// ante throttle se usa fallback MIN y el siguiente ciclo lo retoma.
const METER_CALL_MIN_INTERVAL_MS = 5 * 60 * 1000;
const meterCallTimestamps = new Map();
// Negativo material por desalineación gen/export en una fila: esa fila
// queda con consumption null sin tocar los contadores observados.
const METER_SELF_EPS_KWH = 1e-6;
const INVARIANT_EPS_KWH = 1e-6;

const cumulativeFields = {
  eacToday: 'generation_kwh',
  elocalLoadToday: 'consumption_kwh',
  etoUserToday: 'grid_import_kwh',
  etoGridToday: 'grid_export_kwh',
};

function nonNegativeNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function legacyPayload(entry) {
  // Forma REAL legacy: { "<serial>": [ { ...payload } ] } (array de 1).
  if (Array.isArray(entry)) {
    if (entry.length !== 1) return null;
    const single = entry[0];
    return single && typeof single === 'object' && !Array.isArray(single) ? single : null;
  }
  // Compatibilidad: objeto con un único subíndice y payload válido.
  if (!entry || typeof entry !== 'object') return null;
  const subKeys = Object.keys(entry);
  if (subKeys.length !== 1) return null;
  const payload = entry[subKeys[0]];
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
}

function legacyDeviceData(entries, device) {
  // Envelope legado: devices: { "<serial>": [ { ...payload } ] }.
  // Se resuelve por serial_number sin ambigüedad: exactamente una entrada;
  // en cualquier otro caso se devuelve null (sin elegir).
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return null;
  const wanted = String(device?.serial_number ?? '').trim();
  const keys = Object.keys(entries).filter(key => key === device?.serial_number
    || (wanted !== '' && key.toLowerCase() === wanted.toLowerCase()));
  if (keys.length !== 1) return null;
  return legacyPayload(entries[keys[0]]);
}

function deviceRawData(row, device, deviceCount) {
  const entries = row.raw_data?.devices;
  if (Array.isArray(entries)) {
    return entries.find(entry => entry.device_id === device.id
      || entry.serial_number === device.serial_number)?.data ?? null;
  }
  const legacy = legacyDeviceData(entries, device);
  if (legacy !== null) return legacy;
  return deviceCount === 1 ? row.raw_data ?? null : null;
}

function localDay(rawData) {
  return String(rawData?.time ?? '').match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}

// Paso elemental de derivación por contador, idéntico para MIN y meter:
// primer valor válido del día = contador completo (absorbe lo acumulado
// desde medianoche, p.ej. importación nocturna en la primera muestra),
// luego deltas, y null ante drop/reset/inválido (tombstone).
function nextCounterDelta(references, key, day, current) {
  const previous = references.get(key);
  let delta = null;
  let firstDailyCounter = false;
  if (day && current !== null) {
    if (previous === undefined || (previous.day !== null && previous.day !== day)) {
      delta = current;
      firstDailyCounter = true;
    } else if (previous.day === day && previous.value !== null && current >= previous.value) {
      delta = current - previous.value;
    }
    references.set(key, { day, value: current });
  } else {
    references.set(key, { day: day ?? null, value: null });
  }
  return { delta, firstDailyCounter };
}

function meterCallAllowed(dataloggerSn, now = Date.now()) {
  const last = meterCallTimestamps.get(dataloggerSn) ?? Number.NEGATIVE_INFINITY;
  if (now - last < METER_CALL_MIN_INTERVAL_MS) return false;
  meterCallTimestamps.set(dataloggerSn, now);
  return true;
}

// Deltas del meter sobre SU PROPIO timeline (orden cronológico), antes de
// cualquier alineación: así los huecos MIN no alteran el acumulado.
export function deriveMeterDeltas(meterSamples, meterId, plantTimezone) {
  const references = new Map();
  return [...meterSamples]
    .map(sample => ({
      raw: sample,
      instant: Date.parse(parseGrowattTimestamp(sample?.timeText ?? sample?.time, plantTimezone) ?? ''),
      day: localDay({ time: sample?.timeText ?? sample?.time }),
    }))
    .filter(sample => Number.isFinite(sample.instant) && sample.day !== null)
    .sort((left, right) => left.instant - right.instant)
    .map(sample => {
      const deltas = {};
      const energyProvenance = {};
      for (const [sourceField, targetField] of Object.entries(meterCumulativeFields)) {
        const { delta, firstDailyCounter } = nextCounterDelta(
          references, `${meterId}:${sourceField}`, sample.day,
          nonNegativeNumber(sample.raw?.[sourceField]),
        );
        deltas[targetField] = delta;
        energyProvenance[targetField] = {
          source: 'growatt_meter',
          first_daily_counter: firstDailyCounter,
        };
      }
      return {
        instant: sample.instant, day: sample.day, raw: sample.raw, energyProvenance, ...deltas,
      };
    });
}

// Asociación determinista dirigida por meter: cada delta reclama la fila
// MIN no reclamada más cercana dentro de la ventana (empate: la anterior).
// Un delta jamás se duplica; lo no reclamado va a filas extra.
export function alignMeterDeltas(minInstants, meterDeltas) {
  const claimedMin = new Set();
  const byMinRow = new Map();
  const usedMeter = new Set();
  meterDeltas.forEach((meterDelta, meterIndex) => {
    let bestRow = -1;
    let bestDist = Infinity;
    let bestInstant = Infinity;
    minInstants.forEach(({ instant, rowIndex }) => {
      if (claimedMin.has(rowIndex)) return;
      const dist = Math.abs(instant - meterDelta.instant);
      if (dist <= METER_ALIGN_WINDOW_MS
        && (dist < bestDist || (dist === bestDist && instant < bestInstant))) {
        bestRow = rowIndex;
        bestDist = dist;
        bestInstant = instant;
      }
    });
    if (bestRow !== -1) {
      claimedMin.add(bestRow);
      usedMeter.add(meterIndex);
      byMinRow.set(bestRow, meterIndex);
    }
  });
  return {
    byMinRow,
    unclaimed: meterDeltas.map((_, meterIndex) => meterIndex).filter(index => !usedMeter.has(index)),
  };
}

function meterDeviceEntry(meter, rawSample) {
  return { device_id: meter.id, serial_number: meter.serial_number, data: rawSample };
}

function consumptionFromMeterParts(generation, gridExport, gridImport) {
  if (generation === null || gridExport === null || gridImport === null) return null;
  const self = generation - gridExport;
  if (self < -METER_SELF_EPS_KWH) return null;
  return Math.max(self, 0) + gridImport;
}

function meterEnergyProvenance(meterDelta, consumption) {
  const energyProvenance = { ...meterDelta.energyProvenance };
  if (consumption !== null) {
    energyProvenance.consumption_kwh = {
      source: 'derived',
      depends_on_first_daily_counter: ['grid_import_kwh', 'grid_export_kwh']
        .some(field => meterDelta.energyProvenance?.[field]?.first_daily_counter === true),
    };
  }
  return energyProvenance;
}

// Fusión MIN (generación) + meter (red): en modo meter los contadores
// elocal/etoUser/etoGrid del MIN están congelados y se ignoran; solo
// generation viene del MIN. Sin meter válido no se llama: fallback intacto.
export function mergeMeterEnergy({ plant, minDevices, baseRows, powerRows, meterSamples, meter }) {
  const meterDeltas = deriveMeterDeltas(meterSamples, meter.id, plant.timezone ?? 'UTC');
  const minInstants = [];
  baseRows.forEach((row, rowIndex) => {
    const instant = Date.parse(row.interval_start);
    if (Number.isFinite(instant)) minInstants.push({ instant, rowIndex });
  });
  const { byMinRow, unclaimed } = alignMeterDeltas(minInstants, meterDeltas);
  const rows = baseRows.map((row, rowIndex) => {
    const meterIndex = byMinRow.get(rowIndex);
    if (meterIndex === undefined) {
      return {
        ...row,
        consumption_kwh: null,
        grid_import_kwh: null,
        grid_export_kwh: null,
      };
    }
    const meterDelta = meterDeltas[meterIndex];
    const gridImport = meterDelta.grid_import_kwh;
    const gridExport = meterDelta.grid_export_kwh;
    const consumption = consumptionFromMeterParts(row.generation_kwh, gridExport, gridImport);
    const devices = Array.isArray(row.raw_data?.devices) ? [...row.raw_data.devices] : [];
    devices.push(meterDeviceEntry(meter, meterDelta.raw));
    return {
      ...row,
      consumption_kwh: consumption,
      grid_import_kwh: gridImport,
      grid_export_kwh: gridExport,
      raw_data: {
        ...row.raw_data,
        devices,
        energy_provenance: {
          ...row.raw_data?.energy_provenance,
          ...meterEnergyProvenance(meterDelta, consumption),
        },
      },
    };
  });
  const existingInstants = new Set(minInstants.map(({ instant }) => instant));
  let unmatchedMeterSamples = 0;
  for (const meterIndex of unclaimed) {
    const meterDelta = meterDeltas[meterIndex];
    if (meterDelta.grid_import_kwh === null && meterDelta.grid_export_kwh === null) continue;
    if (meterDelta.grid_import_kwh === 0 && meterDelta.grid_export_kwh === 0) {
      // Delta cero: sin energía que conservar; crear fila solo dañaría la
      // cobertura de generation. Se cuenta como no asociado (transparencia).
      unmatchedMeterSamples += 1;
      continue;
    }
    if (existingInstants.has(meterDelta.instant)) {
      // Colisión temporal exacta con fila existente: rellenar solo nulls.
      const rowIndex = baseRows.findIndex(row => Date.parse(row.interval_start) === meterDelta.instant);
      const target = rows[rowIndex];
      if (target.grid_import_kwh === null) target.grid_import_kwh = meterDelta.grid_import_kwh;
      if (target.grid_export_kwh === null) target.grid_export_kwh = meterDelta.grid_export_kwh;
      if (target.consumption_kwh === null) {
        target.consumption_kwh = consumptionFromMeterParts(
          target.generation_kwh, target.grid_export_kwh, target.grid_import_kwh);
      }
      continue;
    }
    unmatchedMeterSamples += 1;
    existingInstants.add(meterDelta.instant);
    rows.push({
      plant_id: plant.id,
      provider: 'growatt',
      interval_type: 1,
      interval_start: new Date(meterDelta.instant).toISOString(),
      timezone: plant.timezone ?? 'UTC',
      generation_kwh: null,
      consumption_kwh: null,
      grid_import_kwh: meterDelta.grid_import_kwh,
      grid_export_kwh: meterDelta.grid_export_kwh,
      battery_charge_kwh: null,
      battery_discharge_kwh: null,
      raw_data: {
        derived_from: 'growatt_meter_history',
        meter_device_id: meter.id,
        meter: {
          datalogger_sn: meter.metadata?.datalogger_sn ?? null,
          address: meter.metadata?.address ?? null,
        },
        devices: [meterDeviceEntry(meter, meterDelta.raw)],
        energy_provenance: meterEnergyProvenance(meterDelta, null),
      },
      updated_at: new Date().toISOString(),
    });
  }
  rows.sort((left, right) => left.interval_start.localeCompare(right.interval_start));
  // Invariante diaria: Σ deltas == último contador por serie verificable
  // (serie con nulls ese día: no verificable, no falla).
  const dayKey = instant => localDateKey(new Date(instant).toISOString(), plant.timezone ?? 'UTC');
  const lastGenByDay = new Map();
  for (const powerRow of [...(powerRows ?? [])]
    .sort((left, right) => left.interval_start.localeCompare(right.interval_start))) {
    for (const device of minDevices ?? []) {
      const payload = deviceRawData(powerRow, device, (minDevices ?? []).length || 1);
      const day = localDay(payload);
      const current = nonNegativeNumber(payload?.eacToday);
      if (day === null || current === null) continue;
      if (!lastGenByDay.has(day)) lastGenByDay.set(day, new Map());
      lastGenByDay.get(day).set(device.id, current);
    }
  }
  const lastMeterByDay = new Map();
  const orderedMeterSamples = [...(meterSamples ?? [])]
    .map(sample => ({
      day: localDay({ time: sample?.timeText ?? sample?.time }),
      instant: Date.parse(parseGrowattTimestamp(sample?.timeText ?? sample?.time, plant.timezone ?? 'UTC') ?? ''),
      import: nonNegativeNumber(sample?.positiveActiveTodayEnergy),
      export: nonNegativeNumber(sample?.reverseActiveTodayEnergy),
    }))
    .filter(sample => sample.day !== null && Number.isFinite(sample.instant))
    .sort((left, right) => left.instant - right.instant);
  for (const sample of orderedMeterSamples) {
    if (!lastMeterByDay.has(sample.day)) lastMeterByDay.set(sample.day, {});
    if (sample.import !== null) lastMeterByDay.get(sample.day).import = sample.import;
    if (sample.export !== null) lastMeterByDay.get(sample.day).export = sample.export;
  }
  const sumsByDay = new Map();
  const totals = { generation: 0, import: 0, export: 0 };
  for (const row of rows) {
    const day = dayKey(row.interval_start);
    if (day === null) continue;
    if (!sumsByDay.has(day)) {
      sumsByDay.set(day, {
        generation_kwh: { sum: 0, nulls: 0 },
        grid_import_kwh: { sum: 0, nulls: 0 },
        grid_export_kwh: { sum: 0, nulls: 0 },
      });
    }
    const entry = sumsByDay.get(day);
    for (const field of ['generation_kwh', 'grid_import_kwh', 'grid_export_kwh']) {
      if (row[field] === null || row[field] === undefined) entry[field].nulls += 1;
      else entry[field].sum += row[field];
    }
  }
  let invariantOk = true;
  for (const [day, sums] of sumsByDay) {
    const deviceLast = lastGenByDay.get(day);
    const devicesComplete = (minDevices ?? []).length > 0
      && (minDevices ?? []).every(device => deviceLast?.has(device.id));
    if (sums.generation_kwh.nulls === 0 && devicesComplete) {
      const expected = [...deviceLast.values()].reduce((sum, value) => sum + value, 0);
      if (Math.abs(sums.generation_kwh.sum - expected) > INVARIANT_EPS_KWH) invariantOk = false;
    }
    const meterLast = lastMeterByDay.get(day);
    if (sums.grid_import_kwh.nulls === 0 && meterLast?.import !== undefined) {
      if (Math.abs(sums.grid_import_kwh.sum - meterLast.import) > INVARIANT_EPS_KWH) invariantOk = false;
    }
    if (sums.grid_export_kwh.nulls === 0 && meterLast?.export !== undefined) {
      if (Math.abs(sums.grid_export_kwh.sum - meterLast.export) > INVARIANT_EPS_KWH) invariantOk = false;
    }
  }
  for (const sums of sumsByDay.values()) {
    totals.generation += sums.generation_kwh.sum;
    totals.import += sums.grid_import_kwh.sum;
    totals.export += sums.grid_export_kwh.sum;
  }
  return {
    rows,
    meta: {
      meter_used: true,
      meter_device_id: meter.id,
      generation_total: totals.generation,
      meter_import_total: totals.import,
      meter_export_total: totals.export,
      unmatched_meter_samples: unmatchedMeterSamples,
      null_consumption_intervals: rows.filter(row => row.consumption_kwh == null).length,
      null_import_intervals: rows.filter(row => row.grid_import_kwh == null).length,
      null_export_intervals: rows.filter(row => row.grid_export_kwh == null).length,
      invariant_ok: invariantOk,
    },
  };
}

export function deriveGrowattEnergyHistory(plant, devices, powerRows) {
  const references = new Map();
  return [...powerRows].sort((left, right) => left.interval_start.localeCompare(right.interval_start))
    .map(row => {
      const contributions = Object.fromEntries(Object.values(cumulativeFields).map(field => [field, []]));
      for (const device of devices) {
        const rawData = deviceRawData(row, device, devices.length);
        const day = localDay(rawData);
        for (const [sourceField, targetField] of Object.entries(cumulativeFields)) {
          const key = `${device.id}:${sourceField}`;
          const current = nonNegativeNumber(rawData?.[sourceField]);
          const previous = references.get(key);
          let delta = null;
          if (day && current !== null) {
            if (previous === undefined || (previous.day !== null && previous.day !== day)) {
              // Primera referencia legítima del día: los contadores *Today
              // acumulan desde medianoche, por lo que el valor actual es la
              // energía del día hasta esta muestra (0 si comienza en cero).
              delta = current;
            } else if (previous.day === day && previous.value !== null && current >= previous.value) {
              delta = current - previous.value;
            }
            // Referencia rota el mismo día (tombstone) o caída/reset
            // intradía: cobertura desconocida, delta null.
            references.set(key, { day, value: current });
          } else {
            // Muestra inválida o sin día: tombstone que conserva el rastro
            // del día iniciado. La siguiente muestra válida del mismo día
            // NO se trata como inicio (sigue siendo desconocida).
            references.set(key, { day: day ?? null, value: null });
          }
          contributions[targetField].push(delta);
        }
      }
      const energy = Object.fromEntries(Object.values(cumulativeFields).map(field => {
        const values = contributions[field];
        const complete = devices.length > 0 && values.length === devices.length
          && values.every(value => typeof value === 'number' && Number.isFinite(value));
        return [field, complete ? values.reduce((sum, value) => sum + value, 0) : null];
      }));
      return {
        plant_id: plant.id,
        provider: 'growatt',
        interval_type: 1,
        interval_start: row.interval_start,
        timezone: row.timezone ?? plant.timezone ?? 'UTC',
        ...energy,
        battery_charge_kwh: null,
        battery_discharge_kwh: null,
        raw_data: {
          derived_from: 'plant_power_intervals.raw_data',
          power_interval_id: row.id ?? null,
          devices: row.raw_data?.devices ?? null,
        },
        updated_at: new Date().toISOString(),
      };
    });
}

function nullTotals(rows) {
  let total = 0;
  for (const field of Object.values(cumulativeFields)) {
    total += rows.filter(row => row[field] === null || row[field] === undefined).length;
  }
  return total;
}

// Energía observada por canal (solo valores válidos, sin convertir nulls).
function energySums(rows) {
  const sums = { generation_kwh: 0, grid_import_kwh: 0, grid_export_kwh: 0 };
  for (const row of rows) {
    for (const field of Object.keys(sums)) {
      if (row[field] !== null && row[field] !== undefined) sums[field] += row[field];
    }
  }
  return sums;
}

export function preserveEnergyProvenance(rows, existingRows) {
  const existingByInterval = new Map(existingRows.map(row => [Date.parse(row.interval_start), row]));
  return rows.map(row => {
    if (row.raw_data?.energy_provenance != null) return row;
    const existingProvenance = existingByInterval.get(Date.parse(row.interval_start))
      ?.raw_data?.energy_provenance;
    if (existingProvenance == null) return row;
    return {
      ...row,
      raw_data: { ...row.raw_data, energy_provenance: existingProvenance },
    };
  });
}

export async function syncGrowattEnergyHistory(plant, date) {
  let powerRows = await listPlantPowerIntervals(plant.id, date);
  let powerHistorySynced = false;
  if (!powerRows.length) {
    await syncGrowattPowerHistory(plant, date);
    powerHistorySynced = true;
    powerRows = await listPlantPowerIntervals(plant.id, date);
  }
  const devices = await listActiveGrowattMinDevicesByPlant(plant.id);
  let rows = deriveGrowattEnergyHistory(plant, devices, powerRows);
  // Capa meter (canónica para red): solo si existe meter lógico; cualquier
  // fallo o throttle usa el pipeline MIN sin degradar lo existente.
  let meterMeta = { meter_used: false };
  try {
    const meter = typeof listActiveGrowattMeterByPlant === 'function'
      ? await listActiveGrowattMeterByPlant(plant.id)
      : null;
    const dataloggerSn = meter?.metadata?.datalogger_sn ?? null;
    const address = meter?.metadata?.address ?? null;
    if (meter && dataloggerSn !== null && address !== null && meterCallAllowed(dataloggerSn)) {
      const meterSamples = await meterProvider.getMeterHistory(
        dataloggerSn, address, date, date);
      const merged = mergeMeterEnergy({ plant, minDevices: devices, baseRows: rows, powerRows, meterSamples, meter });
      rows = merged.rows;
      meterMeta = merged.meta;
    }
  } catch {
    meterMeta = { meter_used: false };
  }
  // Protección anti-degradación: nunca sobrescribir energy_intervals
  // existentes con una derivación materialmente peor. La comparación es del
  // conjunto completo de la fecha: o se escriben todas las filas o ninguna.
  // Con meter, el invariante Σ==último contador también debe cumplirse.
  const existing = await listEnergyIntervalsRange(plant.id, 1, date, periodRange('day', date).end);
  const existing_nulls = nullTotals(existing);
  const derived_nulls = nullTotals(rows);
  const existingValues = existing.length * Object.keys(cumulativeFields).length - existing_nulls;
  const derivedValues = rows.length * Object.keys(cumulativeFields).length - derived_nulls;
  // Con meter válido (invariant_ok), los consumption=null honestos del
  // desfase MIN/meter no cuentan como degradación; generation/import/export
  // se protegen campo a campo. Sin meter válido, comparación legacy intacta.
  // Con extras meter (gen=null) se mide evidencia, no nulls: solo la pérdida
  // de energía observada por canal bloquea (tolerancia INVARIANT_EPS_KWH).
  const meterTrusted = meterMeta.meter_used === true && meterMeta.invariant_ok === true;
  let coverageDegraded;
  if (meterTrusted) {
    const existingSums = energySums(existing);
    const derivedSums = energySums(rows);
    coverageDegraded = ['generation_kwh', 'grid_import_kwh', 'grid_export_kwh']
      .some(field => derivedSums[field] + INVARIANT_EPS_KWH < existingSums[field]);
  } else {
    coverageDegraded = derived_nulls > existing_nulls;
  }
  const degraded = (existing.length > 0
    && (derivedValues === 0 ? existingValues > 0 : coverageDegraded))
    || (meterMeta.meter_used === true && meterMeta.invariant_ok === false);
  if (degraded) {
    return {
      provider: 'growatt', devices: devices.length, fetched: powerRows.length,
      upserted: 0, failed: 0, power_history_synced: powerHistorySynced,
      skipped_degraded: true, existing_nulls, derived_nulls, ...meterMeta,
    };
  }
  rows = preserveEnergyProvenance(rows, existing);
  await upsertEnergyIntervals(rows);
  return {
    provider: 'growatt', devices: devices.length, fetched: powerRows.length,
    upserted: rows.length, failed: 0, power_history_synced: powerHistorySynced,
    skipped_degraded: false, existing_nulls, derived_nulls, ...meterMeta,
  };
}

export async function syncGrowattEnergyRollups(plant, period, selectedDate) {
  if (!['month', 'year'].includes(period)) throw new Error('Periodo de rollup Growatt inválido');
  const sourceType = period === 'month' ? 1 : 2;
  const targetType = period === 'month' ? 2 : 3;
  const range = periodRange(period, selectedDate);
  const sourceRows = await listEnergyIntervalsRange(plant.id, sourceType, range.start, range.end);
  const result = aggregateHistory(sourceRows, {
    period, selectedDate, kind: 'energy',
    localDate: row => localDateKey(row.interval_start, row.timezone),
  });
  const rows = result.buckets.filter(bucket => bucket.coverage !== 'none').map(bucket => ({
    plant_id: plant.id,
    provider: 'growatt',
    interval_type: targetType,
    interval_start: bucket.interval_start,
    timezone: 'UTC',
    generation_kwh: bucket.generation_kwh,
    consumption_kwh: bucket.consumption_kwh,
    grid_import_kwh: bucket.grid_import_kwh,
    grid_export_kwh: bucket.grid_export_kwh,
    battery_charge_kwh: null,
    battery_discharge_kwh: null,
    raw_data: { derived_from: `energy_intervals.type_${sourceType}`, coverage: bucket.coverage, sample_count: bucket.sample_count },
    updated_at: new Date().toISOString(),
  }));
  await upsertEnergyIntervals(rows);
  return { provider: 'growatt', period, fetched: sourceRows.length, upserted: rows.length, failed: 0 };
}
