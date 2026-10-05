import {listEnergyIntervalsRange} from './src/repositories/energyIntervals.repository.js';

const plantId = 'f68ef23a-979c-412f-bbe0-a271472a587a';
const rows = await listEnergyIntervalsRange(plantId, 1, '2026-09-01', '2026-10-01');

console.log('Total rows:', rows.length);

// Debug localDateKey
const energyFields = ['generation_kwh', 'consumption_kwh', 'grid_import_kwh', 'grid_export_kwh'];

function numeric(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

for (let i = 0; i < Math.min(5, rows.length); i++) {
  const r = rows[i];
  const date = new Date(r.interval_start);
  const zone = r.timezone || 'UTC';
  console.log('Row', i);
  console.log('  interval_start:', r.interval_start);
  console.log('  timezone:', zone);
  console.log('  Date obj:', date.toISOString());
  
  // Try local date key like the function does
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(part => [part.type, part.value]);
    console.log('  Intl parts:', parts);
    const acc = parts.reduce((acc, [type, value]) => { 
      if (type === 'year') acc.year = value; 
      if (type === 'month') acc.month = value; 
      if (type === 'day') acc.day = value; 
      return acc; 
    }, {}).year + '-' + String(acc.month).padStart(2, '0') + '-' + String(acc.day).padStart(2, '0');
    console.log('  local date key:', acc);
  } catch(e) {
    console.log('  Intl error:', e.message);
  }
  
  // Simple approach - just convert to local date string
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const localDate = formatter.format(date);
    console.log('  formatted local date:', localDate);
  } catch(e) {
    console.log('  format error:', e.message);
  }
  console.log('');
}