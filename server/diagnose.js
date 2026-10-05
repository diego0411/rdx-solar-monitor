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

console.log('ROWS:', data.length);
if (data.length) {
  console.log('FIRST:', data[0].interval_start);
  console.log('LAST:', data[data.length - 1].interval_start);
  const fields = ['generation_kwh', 'consumption_kwh', 'grid_import_kwh', 'grid_export_kwh'];
  for (const f of fields) {
    const vals = data.map(r => r[f]).filter(v => v !== null && v !== undefined);
    const nulls = data.filter(r => r[f] === null || r[f] === undefined).length;
    const zeros = data.filter(r => r[f] === 0).length;
    const gt1 = data.filter(r => r[f] > 1).length;
    const sum = vals.reduce((a, b) => a + b, 0);
    const max = vals.length ? Math.max(...vals) : 0;
    const maxRow = data.find(r => r[f] === max);
    console.log(`${f}: sum=${sum.toFixed(3)} max=${max} max_ts=${maxRow?.interval_start} gt1=${gt1} nulls=${nulls} zeros=${zeros}`);
  }
  console.log('\nFIRST 10:');
  data.slice(0, 10).forEach(r => console.log(r.interval_start, r.generation_kwh, r.consumption_kwh, r.grid_import_kwh, r.grid_export_kwh, r.raw_data?.derived_from));
}