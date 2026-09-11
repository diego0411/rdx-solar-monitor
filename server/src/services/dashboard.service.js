import { readDashboardData } from '../repositories/dashboard.repository.js';
import { telemetryFreshness } from './telemetryFreshness.js';

function sum(rows, field) {
  const value = rows.reduce((total, row) => {
    const value = Number(row[field] ?? 0);
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
  return Number(value.toFixed(2));
}

function summarizeHyxiDevices(devices) {
  const inverters = devices.filter(device => ['STRING_INVERTER', 'HYBRID_INVERTER']
    .includes(device.device_type));
  const communication = devices.filter(device => device.device_type === 'COLLECTOR');
  return {
    inverter_total: inverters.length,
    inverter_online: inverters.filter(device => device.status === 'online').length,
    inverter_offline: inverters.filter(device => device.status === 'offline').length,
    inverter_alarm: inverters.filter(device => device.status === 'alarm').length,
    communication_total: communication.length,
    communication_online: communication.filter(device => device.status === 'online').length,
    communication_offline: communication.filter(device => device.status === 'offline').length,
    communication_alarm: communication.filter(device => device.status === 'alarm').length,
  };
}

export async function getDashboardSummary() {
  const data = await readDashboardData();
  const plantIds = new Set(data.plants.map(plant => plant.id));
  const devices = data.devices.filter(device => device.active === true
    && (device.plant_id === null || plantIds.has(device.plant_id)));
  const byId = new Map(devices.map(device => [device.id, device]));
  const latest = data.latest.filter(row => byId.has(row.device_id)).map(row => ({ ...row, device: byId.get(row.device_id) }));
  const scoped = { ...data, devices, latest };
  const now = Date.now();
  const providers = [...new Set([...data.plants, ...devices].map(row => row.provider))].sort();
  return {
    ...summarize(scoped, now),
    providers: providers.map(provider => {
      const providerDevices = devices.filter(row => row.provider === provider);
      return {
        provider,
        ...summarize({
        plants: data.plants.filter(row => row.provider === provider),
        devices: providerDevices,
        latest: latest.filter(row => row.device.provider === provider),
        energy: data.energy.filter(row => row.provider === provider),
        }, now),
        ...(provider === 'hyxi' ? summarizeHyxiDevices(providerDevices) : {}),
      };
    }),
  };
}

function summarize({ plants, devices, latest, energy }, now) {
  const electrical = latest.filter(row => row.device.device_type !== 'COLLECTOR');
  const fresh = electrical.filter(row => telemetryFreshness(row.collected_at, now).data_status === 'fresh');
  // Prefer plant summaries; use device energy only where no plant value exists.
  const summarized = new Set(energy.filter(row => row.today_generation_kwh != null).map(row => row.plant_id));
  const fallback = electrical.filter(row => !summarized.has(row.device.plant_id));
  return {
    total_plants: plants.length,
    online_plants: plants.filter(plant => plant.status === 'online').length,
    offline_plants: plants.filter(plant => plant.status === 'offline').length,
    alarm_plants: plants.filter(plant => plant.status === 'alarm').length,
    total_capacity_kwp: sum(plants, 'capacity_kwp'),
    total_devices: devices.length,
    inverter_devices: devices.filter(device => ['STRING_INVERTER', 'HYBRID_INVERTER']
      .includes(device.device_type)).length,
    communication_devices: devices.filter(device => device.device_type === 'COLLECTOR').length,
    online_devices: devices.filter(device => device.status === 'online').length,
    unknown_devices: devices.filter(device => !['online', 'offline'].includes(device.status)).length,
    current_generation_power_w: sum(fresh, 'pv_power'),
    current_consumption_power_w: sum(fresh, 'load_power'),
    current_grid_import_power_w: sum(fresh, 'grid_import_power'),
    current_grid_export_power_w: sum(fresh, 'grid_export_power'),
    current_battery_charge_power_w: sum(fresh, 'battery_charge_power'),
    current_battery_discharge_power_w: sum(fresh, 'battery_discharge_power'),
    today_generation_kwh: Number((sum(energy, 'today_generation_kwh') + sum(fallback, 'today_energy')).toFixed(2)),
    month_generation_kwh: sum(energy, 'month_generation_kwh'),
    year_generation_kwh: sum(energy, 'year_generation_kwh'),
    total_generation_kwh: sum(energy, 'total_generation_kwh'),
    today_consumption_kwh: sum(energy, 'today_consumption_kwh'),
    active_devices: devices.length,
    offline_devices: devices.filter(device => device.status === 'offline').length,
  };
}
