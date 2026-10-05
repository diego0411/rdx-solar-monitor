import { supabase } from './src/config/supabase.js';

const plantId = 'f68ef23a-979c-412f-bbe0-a271472a587a';

const { data, error } = await supabase
  .from('energy_intervals')
  .select('interval_start, generation_kwh, consumption_kwh, grid_import_kwh, grid_export_kwh, raw_data')
  .eq('plant_id', plantId)
  .eq('interval_type', 1)
  .gte('interval_start', '2026-09-28T00:00:00')
  .lte('interval_start', '2026-09-28T23:59:59')
  .order('interval_start', { ascending: true });

if (error) {
  console.error(error);
  process.exit(1);
}

console.log('=== TOTALES BD ===');
console.log('Rows:', data.length);
console.log('Generation sum:', data.reduce((s, r) => s + (r.generation_kwh || 0), 0).toFixed(3));
console.log('Import sum:', data.reduce((s, r) => s + (r.grid_import_kwh || 0), 0).toFixed(3));
console.log('Export sum:', data.reduce((s, r) => s + (r.grid_export_kwh || 0), 0).toFixed(3));
console.log('Consumption sum:', data.reduce((s, r) => s + (r.consumption_kwh || 0), 0).toFixed(3));

console.log('\n=== CONTADORES METER EN RAW_DATA ===');
const meterCounters = [];
for (const row of data) {
  const devices = row.raw_data?.devices;
  if (Array.isArray(devices)) {
    for (const dev of devices) {
      if (dev.serial_number?.includes('growatt-meter')) {
        const d = dev.data;
        if (d) {
          meterCounters.push({
            ts: row.interval_start,
            positiveActiveTodayEnergy: d.positiveActiveTodayEnergy,
            reverseActiveTodayEnergy: d.reverseActiveTodayEnergy,
            positiveActiveTotalEnergy: d.positiveActiveTotalEnergy,
            reverseActiveTotalEnergy: d.reverseActiveTotalEnergy,
            gridEnergy: d.gridEnergy,
            userEnergy: d.userEnergy,
            todayEnergy: d.todayEnergy,
            totalEnergy: d.totalEnergy,
            activeEnergy: d.activeEnergy,
            forwardActiveEnergy: d.forwardActiveEnergy,
            reverseActiveEnergy: d.reverseActiveEnergy,
            netTotalEnergy: d.netTotalEnergy,
            activePower: d.activePower,
            activePowerL1: d.activePowerL1,
            positiveActivePower: d.posiActivePower,
            reverseActivePower: d.reverActivePower,
            currentL1: d.currentL1,
            voltageL1: d.voltageL1,
          });
        }
      }
    }
  }
}

console.log('Muestras meter:', meterCounters.length);
if (meterCounters.length > 0) {
  console.log('\n--- positiveActiveTodayEnergy ---');
  const posVals = meterCounters.map(m => m.positiveActiveTodayEnergy).filter(v => v !== null && v !== undefined);
  console.log('First:', meterCounters[0]?.positiveActiveTodayEnergy, '@', meterCounters[0]?.ts);
  console.log('Last:', meterCounters[meterCounters.length-1]?.positiveActiveTodayEnergy, '@', meterCounters[meterCounters.length-1]?.ts);
  console.log('Min:', Math.min(...posVals));
  console.log('Max:', Math.max(...posVals));
  console.log('Last - First:', posVals.length >= 2 ? (posVals[posVals.length-1] - posVals[0]).toFixed(3) : 'N/A');
  console.log('Samples:', posVals.length);

  console.log('\n--- reverseActiveTodayEnergy ---');
  const revVals = meterCounters.map(m => m.reverseActiveTodayEnergy).filter(v => v !== null && v !== undefined);
  console.log('First:', meterCounters[0]?.reverseActiveTodayEnergy, '@', meterCounters[0]?.ts);
  console.log('Last:', meterCounters[meterCounters.length-1]?.reverseActiveTodayEnergy, '@', meterCounters[meterCounters.length-1]?.ts);
  console.log('Min:', Math.min(...revVals));
  console.log('Max:', Math.max(...revVals));
  console.log('Last - First:', revVals.length >= 2 ? (revVals[revVals.length-1] - revVals[0]).toFixed(3) : 'N/A');
  console.log('Samples:', revVals.length);

  console.log('\n--- Otros contadores ---');
  const checkField = (field, label) => {
    const vals = meterCounters.map(m => m[field]).filter(v => v !== null && v !== undefined);
    if (vals.length) {
      console.log(`${label}: first=${vals[0]}, last=${vals[vals.length-1]}, delta=${(vals[vals.length-1] - vals[0]).toFixed(3)}, samples=${vals.length}`);
    }
  };
  checkField('positiveActiveTotalEnergy', 'positiveActiveTotalEnergy');
  checkField('reverseActiveTotalEnergy', 'reverseActiveTotalEnergy');
  checkField('gridEnergy', 'gridEnergy');
  checkField('userEnergy', 'userEnergy');
  checkField('todayEnergy', 'todayEnergy');
  checkField('totalEnergy', 'totalEnergy');
  checkField('activeEnergy', 'activeEnergy');
  checkField('forwardActiveEnergy', 'forwardActiveEnergy');
  checkField('reverseActiveEnergy', 'reverseActiveEnergy');
  checkField('netTotalEnergy', 'netTotalEnergy');
}

console.log('\n=== PRIMERAS 5 MUESTRAS METER COMPLETAS ===');
meterCounters.slice(0, 5).forEach(m => console.log(JSON.stringify(m, null, 2)));