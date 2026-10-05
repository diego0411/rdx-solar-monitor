import { supabase } from './src/config/supabase.js';
import { calculatePlantEconomics } from './src/services/plantEconomics.service.js';
import { listPlantEnergyTariffsForRange } from './src/repositories/plantEnergyTariffs.repository.js';
import { listEnergyIntervalsRange } from './src/repositories/energyIntervals.repository.js';
import { periodRange } from './src/services/historyPeriods.js';

const plantId = '00994fa0-19e5-47a9-a69a-3bf6ac6b8d5b';
const start = '2026-09-15';
const end = '2026-09-21';  // end exclusive

const [rows, tariffs] = await Promise.all([
  listEnergyIntervalsRange(plantId, 1, start, end),
  listPlantEnergyTariffsForRange(plantId, start, end),
]);

console.log(`Rows: ${rows.length}`);
console.log(`Tariffs: ${tariffs.length}`);

const result = calculatePlantEconomics(rows, tariffs, { period: 'month', start, end, now: new Date('2026-09-21').getTime() });

console.log('\nECONOMICS RESULT:');
console.log(JSON.stringify(result, null, 2));