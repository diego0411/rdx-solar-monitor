/**
 * Backfill histórico automatizado y seguro para Growatt Smart Meter.
 * 
 * ORQUESTA el proceso: valida argumentos, procesa fechas secuencialmente
 * con throttle 5min, falla-rápido, checkpoints y output formateado.
 * 
 * NO contiene lógica de negocio de merge/min/invariants: reutiliza
 * syncGrowattEnergyHistory y servicios existentes.
 * 
 * Ejecución: node scripts/backfillGrowattEnergyHistory.js --plant-id <uuid> --from YYYY-MM-DD --to YYYY-MM-DD
 */

import { syncGrowattEnergyHistory } from '../src/services/growattEnergyHistory.service.js';
import { listActiveGrowattDevices } from '../src/repositories/devices.repository.js';
import { listEnergyIntervalsRange } from '../src/repositories/energyIntervals.repository.js';
import { upsertEnergyIntervals } from '../src/repositories/energyIntervals.repository.js';
import { localDateKey } from '../src/utils/timezone.js';
import { periodRange } from '../src/services/historyPeriods.js';
import * as fs from 'fs';
import * as path from 'path';
import { supabase } from '../src/config/supabase.js';

const METER_CALL_MIN_INTERVAL_MS = 5 * 60 * 1000;
const MAX_DAYS_DEFAULT = 7;
const CHECKPOINT_PATH = './.cache/growatt-energy-backfill.json';

const energyFields = ['generation_kwh', 'consumption_kwh', 'grid_import_kwh', 'grid_export_kwh'];

function numeric(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Validación de UUID v4 (relaxada: acepta cualquier UUID con guiones).
 */
function isValidUUID(val) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return re.test(val);
}

/**
 * Validación fecha YYYY-MM-DD.
 */
function isValidDate(val) {
  const d = new Date(val);
  return d instanceof Date && !isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}$/.test(val);
}

/**
 * Formatea fecha local YYYY-MM-DD desde un Date.
 */
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Obtiene snapshot BEFORE read-only para una fecha.
 */
async function snapshotBefore(plantId, date, listFn) {
  const nextDay = new Date(`${date}T00:00:00.000Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const endDate = nextDay.toISOString().slice(0, 10);
  const rows = await listFn(plantId, 1, date, endDate);
  let genSum = 0, impSum = 0, expSum = 0;
  let genNulls = 0, impNulls = 0, expNulls = 0, consNulls = 0;

  for (const row of rows) {
    const g = numeric(row.generation_kwh);
    const i = numeric(row.grid_import_kwh);
    const e = numeric(row.grid_export_kwh);
    const c = numeric(row.consumption_kwh);
    if (g !== null) genSum += g; else genNulls++;
    if (i !== null) impSum += i; else impNulls++;
    if (e !== null) expSum += e; else expNulls++;
    // consumption nulls: counted but NOT used as anti-degradation criterion
    if (c !== null) consNulls++;
  }

  return {
    date,
    rows,
    genSum,
    impSum,
    expSum,
    genNulls,
    impNulls,
    expNulls,
    consNulls,
  };
}

/**
 * Ejecuta sync para una fecha y valida el resultado.
 * Retorna el resultado o lanza error con codigo de fallo.
 */
async function processDate(plant, date, listFn, syncFn) {
  console.log(`Procesando fecha: ${date}`);

  // Snapshot BEFORE (solo lectura, no bloquea)
  const before = await snapshotBefore(plant.id, date, listFn);
  console.log(`  BEFORE: gen=${before.genSum.toFixed(1)} imp=${before.impSum.toFixed(1)} exp=${before.expSum.toFixed(1)} nullsG=${before.genNulls} nullsI=${before.impNulls} nullsE=${before.expNulls}`);

  // Ejecuta UNA sola vez syncGrowattEnergyHistory (recibe objeto plant)
  const result = await syncFn(plant, date);

  // Validación fail-fast
  if (result.skipped_degraded === true) {
    throw new Error(`FAIL: skipped_degraded=true para ${date}. No se pudo escribir por degradación.`);
  }
  if (result.meter_used !== true) {
    throw new Error(`FAIL: meter_used!==true (${result.meter_used}) para ${date}.`);
  }
  if (result.invariant_ok !== true && result.meter_used === true) {
    throw new Error(`FAIL: invariant_ok!==true (${result.invariant_ok}) para ${date}.`);
  }
  if (result.skipped_degraded === true) {
    throw new Error(`FAIL: skipped_degraded===true para ${date}.`);
  }
  if (result.upserted === 0) {
    throw new Error(`FAIL: upserted===0 para ${date}. No se insertaron filas.`);
  }

  // Validar que no hubo degradación de generation/import/export (con tolerancia EPS)
  // Solo bloquear si meterTrusted y hay pérdida real de energía observada
  const meterTrusted = result.meter_used === true && result.invariant_ok === true;
  if (meterTrusted) {
    const nextDay = new Date(`${date}T00:00:00.000Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const endDate = nextDay.toISOString().slice(0, 10);
    const afterRows = await listFn(plant.id, 1, date, endDate);
    const beforeSums = energySums(before.rows);
    const afterSums = energySums(afterRows);

    let degradation = false;
    for (const field of ['generation_kwh', 'grid_import_kwh', 'grid_export_kwh']) {
      if (afterSums[field] + 1e-6 < beforeSums[field]) {
        degradation = true;
        console.log(`  --- DEGRADACIÓN detectada en ${field}: antes=${beforeSums[field].toFixed(1)} después=${afterSums[field].toFixed(1)}`);
      }
    }
    if (degradation) {
      throw new Error(`FAIL: degradación de generation/import/export detectada para ${date}.`);
    }
  }

  console.log(`  AFTER: gen=${result.generation_total.toFixed(1)} imp=${result.meter_import_total.toFixed(1)} exp=${result.meter_export_total.toFixed(1)} upserted=${result.upserted} unmatch=${result.unmatched_meter_samples || 0} genN=${before.genNulls} impN=${before.impNulls} expN=${before.expNulls} consN=${before.consNulls}`);

  return result;
}

/**
 * Suma energía observada (solo valores válidos, sin convertir nulls).
 */
function energySums(rows) {
  const sums = { generation_kwh: 0, grid_import_kwh: 0, grid_export_kwh: 0 };
  for (const row of rows) {
    for (const field of Object.keys(sums)) {
      if (row[field] !== null && row[field] !== undefined) sums[field] += row[field];
    }
  }
  return sums;
}

/**
 * Escribe checkpoint local.
 */
function writeCheckpoint(checkpoint) {
  const dir = path.dirname(CHECKPOINT_PATH);
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  try { fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2)); } catch {}
}

/**
 * Lee checkpoint local.
 */
function readCheckpoint() {
  try {
    const data = fs.readFileSync(CHECKPOINT_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Delay asíncrono. Usado para throttle.
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function parseArgs(args) {
  const result = { plantId: null, dateFrom: null, dateTo: null, dryRun: false, maxDays: MAX_DAYS_DEFAULT, resume: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--plant-id' && i + 1 < args.length) result.plantId = args[++i];
    else if (args[i] === '--from' && i + 1 < args.length) result.dateFrom = args[++i];
    else if (args[i] === '--to' && i + 1 < args.length) result.dateTo = args[++i];
    else if (args[i] === '--dry-run') result.dryRun = true;
    else if (args[i] === '--max-days' && i + 1 < args.length) result.maxDays = parseInt(args[++i], 10);
    else if (args[i] === '--resume') result.resume = true;
  }
  return result;
}

function generateDates(dateFrom, dateTo) {
  const [fy, fm, fd] = dateFrom.split('-').map(Number);
  const [ty, tm, td] = dateTo.split('-').map(Number);
  const fromMs = new Date(fy, fm - 1, fd).getTime();
  const toMs = new Date(ty, tm - 1, td).getTime();
  const dates = [];
  for (let d = fromMs; d <= toMs; d += 86400000) {
    dates.push(formatDate(new Date(d)));
  }
  return dates;
}

export async function runBackfill(options) {
  const {
    plantId, dateFrom, dateTo, dryRun, maxDays, resume,
    sleepFn = delay,
    syncFn = syncGrowattEnergyHistory,
    listBeforeFn = listEnergyIntervalsRange,
    supabaseClient = supabase,
  } = options;

  if (!plantId) throw new Error('ERROR: --plant-id es obligatorio.');
  if (!isValidUUID(plantId)) throw new Error('ERROR: --plant-id debe ser un UUID válido.');
  if (!dateFrom || !isValidDate(dateFrom)) throw new Error('ERROR: --from debe ser YYYY-MM-DD válido.');
  if (!dateTo || !isValidDate(dateTo)) throw new Error('ERROR: --to debe ser YYYY-MM-DD válido.');

  const [fy, fm, fd] = dateFrom.split('-').map(Number);
  const [ty, tm, td] = dateTo.split('-').map(Number);
  const fromMs = new Date(fy, fm - 1, fd).getTime();
  const toMs = new Date(ty, tm - 1, td).getTime();
  if (fromMs > toMs) throw new Error('ERROR: --from debe ser <= --to.');

  const dayDiff = Math.ceil((toMs - fromMs) / (86400000));
  if (dayDiff > maxDays) throw new Error(`ERROR: El rango abarca ${dayDiff} días, máximo permitido es ${maxDays}. Use --max-days N o reduzca el rango.`);

  let plant;
  try {
    const { data, error } = await supabaseClient.from('plants').select('*').eq('id', plantId).single();
    if (error || !data) throw new Error('Planta no encontrada: ' + (error?.message || error));
    if (data.provider !== 'growatt') throw new Error('Planta no es provider growatt');
    plant = data;
    plant.fromDate = dateFrom;
    plant.toDate = dateTo;
    plant.completedDates = plant.completedDates || [];
    plant.failedDate = plant.failedDate || null;
  } catch (e) {
    throw new Error('ERROR al consultar planta: ' + e.message);
  }

  if (dryRun) {
    console.log('DRY RUN - no se ejecutará syncGrowattEnergyHistory');
    console.log('---');
    console.log('Plant ID:', plantId);
    console.log('Rango:', dateFrom, '→', dateTo);
    console.log('Días:', dayDiff + 1);
    console.log('Fechas a procesar:');
    const dates = generateDates(dateFrom, dateTo);
    for (const date of dates) {
      console.log('  -', date);
    }
    console.log('---');
    console.log('Validación de argumentos: OK');
    console.log('No se consultarán datos Growatt ni se escribirá energy_intervals.');
    return { dryRun: true, dates };
  }

  const allDates = generateDates(dateFrom, dateTo);

  let startIndex = 0;
  if (resume) {
    const cp = readCheckpoint();
    if (cp && cp.last_completed_date) {
      const lastCp = new Date(cp.last_completed_date);
      const startMs = lastCp.getTime() + 86400000;
      const fromDt = new Date(fromMs);
      if (startMs > fromDt.getTime()) {
        startIndex = allDates.findIndex(d => new Date(d).getTime() >= startMs);
        if (startIndex < 0) startIndex = 0;
        console.log(`--resume: reanudando desde ${cp.last_completed_date} → siguiente día ${allDates[startIndex] || 'final'}`);
      } else {
        console.log('--resume: checkpoint anterior inicia antes de --from, reanudando desde --from');
      }
    } else {
      console.log('--resume: no hay checkpoint previo válido, iniciando desde --from');
    }
  } else {
    try { fs.unlinkSync(CHECKPOINT_PATH); } catch {}
    console.log('Ejecución nueva (sin --resume): checkpoint previo descartado');
  }

  const validDates = allDates.slice(startIndex).sort();

  console.log(`BACKFILL Growatt Energy History`);
  console.log(`Plant: ${plantId}`);
  console.log(`Rango: ${dateFrom} → ${dateTo} (${validDates.length} fechas a procesar)`);
  console.log(`Max-days: ${maxDays} (rango=${dayDiff+1} días)`);
  if (resume) console.log(`Resume from checkpoint: enabled (continuará desde ${readCheckpoint()?.last_completed_date || 'beginning'})`);
  console.log('');

  let completed = 0;
  let failed = 0;
  let stopped = false;
  let lastMeterCall = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < validDates.length; i++) {
    const date = validDates[i];

    const now = Date.now();
    const timeSinceLastMeter = now - lastMeterCall;
    if (timeSinceLastMeter < METER_CALL_MIN_INTERVAL_MS && i > 0) {
      const waitMs = METER_CALL_MIN_INTERVAL_MS - timeSinceLastMeter;
      console.log(`  ⏳ Esperando ${Math.round(waitMs / 1000)}s antes de próxima llamada meter...`);
      await sleepFn(waitMs);
    }

    try {
      const before = await snapshotBefore(plant.id, date, listBeforeFn);
      const result = await processDate(plant, date, listBeforeFn, syncFn);

      console.log(`${date} before_gen=${before.genSum.toFixed(1)} after_gen=${result.generation_total.toFixed(1)} import=${result.meter_import_total.toFixed(1)} export=${result.meter_export_total.toFixed(1)} upserted=${result.upserted} unmatched=${result.unmatched_meter_samples || 0} gen_nulls=${before.genNulls} imp_nulls=${before.impNulls} exp_nulls=${before.expNulls} cons_nulls=${before.consNulls} meter_used=${result.meter_used} invariant_ok=${result.invariant_ok} status=${result.skipped_degraded === false ? 'COMPLETED' : 'DEGRADED'}`);

      completed++;
      lastMeterCall = Date.now();

      if (i < validDates.length - 1) {
        console.log(`  ⏳ Pausa entre días...`);
        await sleepFn(METER_CALL_MIN_INTERVAL_MS);
      }

    } catch (err) {
      console.error(`ERROR en ${date}: ${err.message}`);
      failed++;
      plant.failedDate = date;
      plant.completedDates = plant.completedDates.filter(d => d !== date);
      stopped = true;

      writeCheckpoint({
        plant_id: plantId,
        from: dateFrom,
        to: dateTo,
        last_completed_date: validDates[i - 1] || null,
        completed_dates: plant.completedDates,
        failed_date: date,
        status: 'STOPPED',
        updated_at: new Date().toISOString(),
      });

      break;
    }
  }

  return { completed, failed, stopped, total: validDates.length };
}

async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);
  try {
    await runBackfill(options);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('FATAL ERROR:', err);
    process.exit(1);
  });
}