import { supabase } from './src/config/supabase.js';

const { data, error } = await supabase
  .from('energy_intervals')
  .select('interval_start, generation_kwh, grid_import_kwh, grid_export_kwh, raw_data')
  .eq('plant_id', '00994fa0-19e5-47a9-a69a-3bf6ac6b8d5b')
  .eq('interval_type', 1)
  .gte('interval_start', '2026-09-15T00:00:00')
  .lte('interval_start', '2026-09-20T23:59:59')
  .order('interval_start', { ascending: true });

if (error) {
  console.error(error);
  process.exit(1);
}

const byDay = {};
for (const row of data) {
  const day = row.interval_start.slice(0, 10);
  if (!byDay[day]) byDay[day] = { rows: 0, gen: 0, imp: 0, exp: 0, meter_rows: 0, min_rows: 0 };
  byDay[day].rows++;
  byDay[day].gen += row.generation_kwh || 0;
  byDay[day].imp += row.grid_import_kwh || 0;
  byDay[day].exp += row.grid_export_kwh || 0;

  const devices = row.raw_data?.devices;
  const hasMeter = Array.isArray(devices) && devices.some(d => d && d.serial_number && d.serial_number !== 'ZJP2E7F00A');
  const derivedFrom = row.raw_data?.derived_from;
  if (derivedFrom === 'growatt_meter_history' || hasMeter) {
    byDay[day].meter_rows++;
  } else {
    byDay[day].min_rows++;
  }
}
console.log(JSON.stringify(byDay, null, 2));