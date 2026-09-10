import { supabase } from '../config/supabase.js';

export async function upsertPlantPowerIntervals(rows) {
  if (!rows.length) return;
  const { error } = await supabase.from('plant_power_intervals').upsert(rows, {
    onConflict: 'plant_id,interval_start',
  });
  if (error) throw new Error('No se pudo guardar la curva de potencia');
}

export async function listPlantPowerIntervals(plantId, startTime) {
  const start = Date.parse(`${startTime}T00:00:00.000Z`);
  // Pad UTC bounds for timezone offsets, then filter by the stored local date.
  const lower = new Date(start - 86400000).toISOString();
  const upper = new Date(start + 2 * 86400000).toISOString();
  const rows = [];
  const formatters = new Map();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from('plant_power_intervals').select('*')
      .eq('plant_id', plantId).gte('interval_start', lower).lt('interval_start', upper)
      .order('interval_start', { ascending: true }).range(offset, offset + 999);
    if (error) throw new Error('No se pudo consultar la curva de potencia');
    for (const row of data) {
      const timezone = row.timezone ?? 'UTC';
      if (!formatters.has(timezone)) formatters.set(timezone, new Intl.DateTimeFormat('en-US', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      }));
      const parts = Object.fromEntries(formatters.get(timezone)
        .formatToParts(new Date(row.interval_start)).map(part => [part.type, part.value]));
      if (`${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}` === startTime) rows.push(row);
    }
    if (data.length < 1000) return rows;
  }
}
