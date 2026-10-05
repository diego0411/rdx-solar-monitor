import { supabase } from './src/config/supabase.js';

const { data, error } = await supabase
  .from('energy_intervals')
  .select('*')
  .eq('plant_id', 'f68ef23a-979c-412f-bbe0-a271472a587a')
  .eq('interval_type', 1)
  .gte('interval_start', '2026-09-28T00:00:00')
  .lte('interval_start', '2026-09-28T23:59:59')
  .order('interval_start', { ascending: true });

if (error) {
  console.error(error);
  process.exit(1);
}

// Find the peak row
const peakRow = data.find(r => r.consumption_kwh === 5.899993896484375);
console.log('PEAK ROW:');
console.log(JSON.stringify(peakRow, null, 2));

// Check all rows with consumption > 0
console.log('\nROWS WITH CONSUMPTION > 0:');
data.filter(r => r.consumption_kwh && r.consumption_kwh > 0).forEach(r => 
  console.log(r.interval_start, 'gen:', r.generation_kwh, 'cons:', r.consumption_kwh, 'imp:', r.grid_import_kwh, 'exp:', r.grid_export_kwh, 'prov:', r.raw_data?.derived_from)
);

// Check all rows with import > 0
console.log('\nROWS WITH IMPORT > 0:');
data.filter(r => r.grid_import_kwh && r.grid_import_kwh > 0).forEach(r => 
  console.log(r.interval_start, 'gen:', r.generation_kwh, 'cons:', r.consumption_kwh, 'imp:', r.grid_import_kwh, 'exp:', r.grid_export_kwh, 'prov:', r.raw_data?.derived_from)
);

// Check raw_data for first row
console.log('\nFIRST ROW RAW_DATA:');
console.log(JSON.stringify(data[0].raw_data, null, 2));