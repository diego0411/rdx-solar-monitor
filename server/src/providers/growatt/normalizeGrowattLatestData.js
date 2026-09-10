function value(data, ...keys) {
  for (const key of keys) {
    if (data?.[key] !== undefined && data[key] !== null) return data[key];
  }
  return null;
}

export function normalizeGrowattLatestData(data, deviceId) {
  return {
    device_id: deviceId,
    provider: 'growatt',
    collected_at: value(data, 'time'),
    pv_power: value(data, 'powerOfPhotovoltaic'),
    today_energy: value(data, 'esystemToday'),
    total_energy: value(data, 'esystemTotal'),
    load_power: value(data, 'powerOfLoad'),
    grid_import_power: value(data, 'powerOfGridTake'),
    grid_export_power: value(data, 'powerOfGridFeed'),
    battery_charge_power: value(data, 'chargePowerOfBattery'),
    battery_discharge_power: value(data, 'disChargePowerOfBattery'),
    device_status: value(data, 'statusText'),
    raw_data: data,
  };
}
