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

// Extract ALL meter fields from raw_data
const meterSamples = [];
for (const row of data) {
  const devices = row.raw_data?.devices;
  if (Array.isArray(devices)) {
    for (const dev of devices) {
      if (dev.serial_number?.includes('growatt-meter')) {
        const d = dev.data;
        if (d) {
          const sample = { ts: row.interval_start };
          // Extract all numeric fields
          for (const [key, value] of Object.entries(d)) {
            if (typeof value === 'number' && Number.isFinite(value)) {
              sample[key] = value;
            }
          }
          meterSamples.push(sample);
        }
      }
    }
  }
}

console.log('=== MUESTRAS METER:', meterSamples.length, '===\n');

// Analyze each field
const fields = [
  'positiveActiveTodayEnergy',
  'reverseActiveTodayEnergy',
  'positiveActiveTotalEnergy',
  'reverseActiveTotalEnergy',
  'gridEnergy',
  'userEnergy',
  'todayEnergy',
  'totalEnergy',
  'activeEnergy',
  'reverseActiveEnergy',
  'forwardActiveEnergy',
  'netTotalEnergy',
  'positiveActivePower',
  'reverseActivePower',
  'activePower',
  'activePowerL1',
  'currentL1',
  'voltageL1',
  'powerFactor',
  'frequency',
  'activeEnergy',
];

for (const field of fields) {
  const vals = meterSamples.map(s => s[field]).filter(v => v !== undefined);
  if (vals.length > 0) {
    const first = vals[0];
    const last = vals[vals.length - 1];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const delta = last - first;
    console.log(`${field}:`);
    console.log(`  first: ${first} @ ${meterSamples.find(s => s[field] === first)?.ts}`);
    console.log(`  last:  ${last} @ ${meterSamples.find(s => s[field] === last)?.ts}`);
    console.log(`  min: ${min}`);
    console.log(`  max: ${max}`);
    console.log(`  last-first: ${delta.toFixed(3)}`);
    console.log(`  samples: ${vals.length}`);
    console.log('');
  }
}

// Also check for any field with "coefficient", "factor", "ct", "pt", "ratio", "multiplier"
console.log('=== BUSCANDO CAMPOS DE ESCALA ===');
const scaleFields = new Set();
for (const s of meterSamples) {
  for (const key of Object.keys(s)) {
    const lk = key.toLowerCase();
    if (lk.includes('coeff') || lk.includes('factor') || lk.includes('ct') || lk.includes('pt') || lk.includes('ratio') || lk.includes('mult') || lk.includes('scale')) {
      scaleFields.add(key);
    }
  }
}
if (scaleFields.size > 0) {
  for (const f of scaleFields) {
    const vals = meterSamples.map(s => s[f]).filter(v => v !== undefined);
    if (vals.length > 0) {
      console.log(`${f}: ${[...new Set(vals)].slice(0,10).join(', ')} (${vals.length} samples)`);
    }
  }
} else {
  console.log('No scale fields found in meter samples');
}