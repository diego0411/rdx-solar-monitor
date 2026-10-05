import {listEnergyIntervalsRange} from './src/repositories/energyIntervals.repository.js';
import {listPlantEnergyTariffsForRange} from './src/repositories/plantEnergyTariffs.repository.js';
import {calculatePlantEconomics} from './src/services/plantEconomics.service.js';
import {getStoredPlantById} from './src/repositories/plants.repository.js';

const plantId = 'f68ef23a-979c-412f-bbe0-a271472a587a';
const plant = await getStoredPlantById(plantId);

const rows = await listEnergyIntervalsRange(plantId, 1, '2026-09-01', '2026-10-01');
const tariffs = await listPlantEnergyTariffsForRange(plantId, '2026-09-01', '2026-10-01');
const eco = calculatePlantEconomics(rows, tariffs, {period: 'month', start: '2026-09-01', end: '2026-10-01'});

console.log('meter_suspect=' + eco.coverage.meter_suspect);
console.log('suspect_days=' + eco.coverage.suspect_days);

const energyFields = ['generation_kwh', 'consumption_kwh', 'grid_import_kwh', 'grid_export_kwh'];

function numeric(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function localDateKey(instant, timezone) {
  const date = new Date(instant instanceof Date ? instant.getTime() : Date.parse(instant));
  if (isNaN(date.getTime())) return null;
  const zone = String(timezone ?? 'UTC').trim() || 'UTC';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const year = parts.find(p => p.type === 'year').value;
    const month = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;
    return year + '-' + month.padStart(2, '0') + '-' + day.padStart(2, '0');
  } catch { return null; }
}

// Test localDateKey on first few rows directly
console.log('Testing localDateKey:');
for (let i = 0; i < Math.min(5, rows.length); i++) {
  const r = rows[i];
  const ld = localDateKey(r.interval_start, r.timezone);
  console.log('Row', i, 'localDateKey:', ld, 'interval_start:', r.interval_start, 'tz:', r.timezone);
}

const intervalResults = rows.map(row => {
  const values = Object.fromEntries(energyFields.map(field => [field, numeric(row[field])]));
  const localDate = localDateKey(row.interval_start, row.timezone);
  console.log('Mapped row', row.interval_start, '-> localDate:', localDate);
  return { ...values, local_date: localDate };
});

console.log('Total intervalResults:', intervalResults.length);
console.log('localDates:', intervalResults.map(r => r.local_date).filter(d => d !== null).slice(0, 10));