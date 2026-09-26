import { supabase } from '../config/supabase.js';

async function readPages(query, order) {
  const rows = [];

  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await query()
      .order(order, { ascending: true })
      .range(offset, offset + 999);

    if (error) {
      throw new Error(
        'No se pudieron consultar los datos del dashboard'
      );
    }

    rows.push(...data);

    if (data.length < 1000) {
      return rows;
    }
  }
}

export async function readDashboardData(plantIds = null) {
  if (plantIds !== null && plantIds.size === 0) {
    return {
      plants: [],
      devices: [],
      latest: [],
      energy: [],
    };
  }

  const ids = plantIds === null ? null : [...plantIds];

  const [
    plants,
    devices,
    latest,
    energy,
  ] = await Promise.all([
    readPages(
      () => {
        let q = supabase
          .from('plants')
          .select(
            'id, provider, status, capacity_kwp, name'
          )
          .eq('active', true);
        if (ids) q = q.in('id', ids);
        return q;
      },
      'id'
    ),

    readPages(
      () => {
        let q = supabase
          .from('devices')
          .select(
            'id, plant_id, provider, active, status, device_type, plant:plants(timezone)'
          );
        if (ids) q = q.in('plant_id', ids);
        return q;
      },
      'id'
    ),

    readPages(
      () => {
        let q = supabase
          .from('device_latest_data')
          .select(
            [
              'device_id',
              'pv_power',
              'ac_power',
              'collected_at',
              'updated_at',
              'load_power',
              'grid_import_power',
              'grid_export_power',
              'battery_charge_power',
              'battery_discharge_power',
              'today_energy',
              'device:devices!inner(plant_id)',
            ].join(', ')
          );
        if (ids) q = q.in('device.plant_id', ids);
        return q;
      },
      'device_id'
    ),

    readPages(
      () => {
        let q = supabase
          .from('plant_energy_summary')
          .select(
            [
              'plant_id',
              'provider',
              'today_generation_kwh',
              'month_generation_kwh',
              'year_generation_kwh',
              'total_generation_kwh',
              'today_consumption_kwh',
              'plant:plants!inner(active)',
            ].join(', ')
          )
          .eq('plant.active', true);
        if (ids) q = q.in('plant_id', ids);
        return q;
      },
      'plant_id'
    ),
  ]);

  return {
    plants,
    devices,
    latest,
    energy,
  };
}