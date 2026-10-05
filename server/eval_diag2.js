import {listEnergyIntervalsRange} from './src/repositories/energyIntervals.repository.js';

const plantId = 'f68ef23a-979c-412f-bbe0-a271472a587a';
const rows = await listEnergyIntervalsRange(plantId, 1, '2026-09-01', '2026-10-01');

console.log('Total rows:', rows.length);

const dates = rows.map(r => r.interval_start).sort();
console.log('Date range:', dates[0], 'to', dates[dates.length-1]);

// Show first few interval_start values with timezone
for (let i = 0; i < Math.min(10, rows.length); i++) {
  const r = rows[i];
  console.log('Row', i, 'interval_start:', r.interval_start, 'timezone:', r.timezone);
}