import {listEnergyIntervalsRange} from './src/repositories/energyIntervals.repository.js';
import {listPlantEnergyTariffsForRange} from './src/repositories/plantEnergyTariffs.repository.js';
import {calculatePlantEconomics} from './src/services/plantEconomics.service.js';
import {getStoredPlantById} from './src/repositories/plants.repository.js';
import {localDateKey} from './src/utils/timezone.js';

const plantId = 'f68ef23a-979c-412f-bbe0-a271472a587a';
const plant = await getStoredPlantById(plantId);

const rows = await listEnergyIntervalsRange(plantId, 1, '2026-09-01', '2026-10-01');
const tariffs = await listPlantEnergyTariffsForRange(plantId, '2026-09-01', '2026-10-01');
const eco = calculatePlantEconomics(rows, tariffs, {period: 'month', start: '2026-09-01', end: '2026-10-01'});

console.log('=== ECONOMICS FRESCA ===');
console.log('meter_suspect=' + eco.coverage.meter_suspect);
console.log('suspect_days=' + eco.coverage.suspect_days);
console.log('generation=' + eco.metrics.generation_kwh.value);
console.log('consumption=' + eco.metrics.consumption_kwh.value);
console.log('import=' + eco.metrics.grid_import_kwh.value);
console.log('export=' + eco.metrics.grid_export_kwh.value);
console.log('status=' + eco.coverage.status);

const energyFields = ['generation_kwh', 'consumption_kwh', 'grid_import_kwh', 'grid_export_kwh'];

function numeric(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const intervalResults = rows.map(row => {
  const values = Object.fromEntries(energyFields.map(field => [field, numeric(row[field])]));
  const localDate = localDateKey(row.interval_start, row.timezone);
  return { ...values, local_date: localDate };
});

const byLocalDay = new Map();
for (const row of intervalResults) {
  if (row.local_date === null) continue;
  if (!byLocalDay.has(row.local_date)) byLocalDay.set(row.local_date, []);
  byLocalDay.get(row.local_date).push(row);
}

console.log('');
console.log('=== BYLOCALDAY 15->27 ===');

for (const [date, group] of [...byLocalDay.entries()].sort()) {
  const gen_nn = group.filter(r => r.generation_kwh !== null).length;
  const gen_t = group.length;
  const cons_nn = group.filter(r => r.consumption_kwh !== null).length;
  const cons_t = group.length;
  const imp_nn = group.filter(r => r.grid_import_kwh !== null).length;
  const exp_nn = group.filter(r => r.grid_export_kwh !== null).length;
  const gen_sum = group.reduce((t, r) => t + r.generation_kwh, 0);
  const cons_sum = group.reduce((t, r) => t + r.consumption_kwh, 0);
  const imp_sum = group.reduce((t, r) => t + r.grid_import_kwh, 0);
  const exp_sum = group.reduce((t, r) => t + r.grid_export_kwh, 0);
  const complete_c = group.every(r => r.consumption_kwh !== null);
  const complete_i = group.every(r => r.grid_import_kwh !== null);
  const complete_e = group.every(r => r.grid_export_kwh !== null);
  const gen_ok = group.some(r => r.generation_kwh !== null) && gen_sum > 0;
  const cons_ok = complete_c && cons_sum === 0;
  const imp_ok = complete_i && imp_sum === 0;
  const exp_ok = complete_e && exp_sum === 0;
  const suspectDay = gen_ok && cons_ok && imp_ok && exp_ok;
  
  console.log(date + ' len=' + group.length + ' gen_nn=' + gen_nn + '/' + gen_t + ' cons_nn=' + cons_nn + '/' + cons_t + ' imp_nn=' + imp_nn + '/' + group.length + ' exp_nn=' + exp_nn + '/' + group.length);
  console.log('  gen_s=' + gen_sum.toFixed(1) + ' cons_s=' + cons_sum.toFixed(1) + ' imp_s=' + imp_sum.toFixed(1) + ' exp_s=' + exp_sum.toFixed(1));
  console.log('  complete_c=' + complete_c + ' complete_i=' + complete_i + ' complete_e=' + complete_e);
  console.log('  gen_ok=' + gen_ok + ' cons_ok=' + cons_ok + ' imp_ok=' + imp_ok + ' exp_ok=' + exp_ok);
  console.log('  suspectDay=' + suspectDay);
}

console.log('');
console.log('=== 18/09 DETAIL ===');
const group18 = byLocalDay.get('2026-09-18');
if (group18) {
  console.log('rows=' + group18.length);
  console.log('generation valid/null=' + group18.filter(r => r.generation_kwh !== null).length + '/' + group18.length);
  console.log('consumption valid/null=' + group18.filter(r => r.consumption_kwh !== null).length + '/' + group18.length);
  console.log('import valid/null=' + group18.filter(r => r.grid_import_kwh !== null).length + '/' + group18.length);
  console.log('export valid/null=' + group18.filter(r => r.grid_export_kwh !== null).length + '/' + group18.length);
  
  console.log('');
  console.log('generation_kwh values:');
  group18.forEach(r => console.log('  ' + r.interval_start + ' gen=' + r.generation_kwh + ' cons=' + r.consumption_kwh + ' imp=' + r.grid_import_kwh + ' exp=' + r.grid_export_kwh));
  
  console.log('');
  const gen_ok = group18.some(r => r.generation_kwh !== null) && group18.reduce((t, r) => t + r.generation_kwh, 0) > 0;
  const cons_ok = group18.every(r => r.consumption_kwh !== null) && group18.reduce((t, r) => t + r.consumption_kwh, 0) === 0;
  const imp_ok = group18.every(r => r.grid_import_kwh !== null) && group18.reduce((t, r) => t + r.grid_import_kwh, 0) === 0;
  const exp_ok = group18.every(r => r.grid_export_kwh !== null) && group18.reduce((t, r) => t + r.grid_export_kwh, 0) === 0;
  const suspectDay = gen_ok && cons_ok && imp_ok && exp_ok;
  console.log('A=gen valid:' + group18.some(r => r.generation_kwh !== null));
  console.log('B=sum gen>0:' + group18.reduce((t, r) => t + r.generation_kwh, 0) > 0);
  console.log('C=cons complete&&sum=0:' + cons_ok);
  console.log('D=imp complete&&sum=0:' + imp_ok);
  console.log('E=exp complete&&sum=0:' + exp_ok);
  console.log('suspectDay(18)=' + suspectDay);
}

console.log('');
console.log('=== COMPARISON ===');
console.log('suspectDay(18/09)=' + (group18 ? (function() {
  const gen_ok = group18.some(r => r.generation_kwh !== null) && group18.reduce((t, r) => t + r.generation_kwh, 0) > 0;
  const cons_ok = group18.every(r => r.consumption_kwh !== null) && group18.reduce((t, r) => t + r.consumption_kwh, 0) === 0;
  const imp_ok = group18.every(r => r.grid_import_kwh !== null) && group18.reduce((t, r) => t + r.grid_import_kwh, 0) === 0;
  const exp_ok = group18.every(r => r.grid_export_kwh !== null) && group18.reduce((t, r) => t + r.grid_export_kwh, 0) === 0;
  return gen_ok && cons_ok && imp_ok && exp_ok;
})() : 'N/A'));
console.log('suspect_days.includes(18/09)=' + eco.coverage.suspect_days.includes('2026-09-18'));