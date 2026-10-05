import {listEnergyIntervalsRange} from './src/repositories/energyIntervals.repository.js';

const plantId = 'f68ef23a-979c-412f-bbe0-a271472a587a';
const rows = await listEnergyIntervalsRange(plantId, 1, '2026-09-01', '2026-10-01');

console.log('Total rows:', rows.length);

// Debug localDateKey step by step
for (let i = 0; i < Math.min(3, rows.length); i++) {
  const r = rows[i];
  const date = new Date(r.interval_start);
  const zone = r.timezone || 'UTC';
  console.log('Row', i);
  console.log('  interval_start:', r.interval_start);
  console.log('  timezone:', zone);
  
  // Step by step localDateKey
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    console.log('  formatToParts result:', JSON.stringify(parts.slice(0, 5)));
    
    const year = parts.find(p => p.type === 'year').value;
    const month = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;
    const localDate = year + '-' + month.padStart(2, '0') + '-' + day.padStart(2, '0');
    console.log('  localDateKey result:', localDate);
  } catch(e) {
    console.log('  Error:', e.message);
  }
  
  // Also try the simple approach
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const localDate = formatter.format(date);
    console.log('  formatter.format result:', localDate);
  } catch(e) {
    console.log('  formatter error:', e.message);
  }
  console.log('');
}