import { readDashboardData } from '../repositories/dashboard.repository.js';
import { telemetryFreshness } from './telemetryFreshness.js';
import {
  growattDeviceState,
  isSameCalendarDay,
} from '../providers/growatt/growattStates.js';

function sum(rows, field) {
  const value = rows.reduce((total, row) => {
    const value = Number(row[field] ?? 0);
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);

  return Number(value.toFixed(2));
}

function growattEffectiveTimestamp(row) {
  return row?.collected_at
    ?? row?.updated_at
    ?? null;
}

/**
 * Marca temporal de telemetría de un dispositivo.
 *
 * Para Growatt con dato eléctrico permite el fallback a
 * updated_at (mismo criterio que plants overview), de modo
 * que la telemetría del parque y la de cada planta
 * coincidan.
 */
function telemetryTimestamp(row) {
  if (!row) return null;

  if (row.collected_at) return row.collected_at;

  if (
    row.device?.provider === 'growatt'
    && row.device.device_type !== 'COLLECTOR'
  ) {
    return row.updated_at ?? null;
  }

  return null;
}

function summarizeHyxiDevices(devices) {
  const inverters = devices.filter(device =>
    ['STRING_INVERTER', 'HYBRID_INVERTER']
      .includes(device.device_type)
  );

  const communication = devices.filter(
    device => device.device_type === 'COLLECTOR'
  );

  return {
    inverter_total: inverters.length,

    inverter_online:
      inverters.filter(device => device.status === 'online').length,

    inverter_offline:
      inverters.filter(device => device.status === 'offline').length,

    inverter_alarm:
      inverters.filter(device => device.status === 'alarm').length,

    communication_total: communication.length,

    communication_online:
      communication.filter(device => device.status === 'online').length,

    communication_offline:
      communication.filter(device => device.status === 'offline').length,

    communication_alarm:
      communication.filter(device => device.status === 'alarm').length,
  };
}

export async function getDashboardSummary(plantIds = null) {
  const data = await readDashboardData(plantIds);

  const plantIdSet = new Set(
    data.plants.map(plant => plant.id)
  );

  const devices = data.devices.filter(
    device =>
      device.active === true
      && (
        device.plant_id === null
        || plantIdSet.has(device.plant_id)
      )
  );

  const byId = new Map(
    devices.map(device => [device.id, device])
  );

  const latest = data.latest
    .filter(row => byId.has(row.device_id))
    .map(row => ({
      ...row,
      device: byId.get(row.device_id),
    }));

  const scoped = {
    ...data,
    devices,
    latest,
  };

  const now = Date.now();

  const providers = [
    ...new Set(
      [...data.plants, ...devices]
        .map(row => row.provider)
    ),
  ].sort();

  return {
    ...summarize(scoped, now),

    providers: providers.map(provider => {
      const providerDevices = devices.filter(
        row => row.provider === provider
      );

      return {
        provider,

        ...summarize(
          {
            plants: data.plants.filter(
              row => row.provider === provider
            ),

            devices: providerDevices,

            latest: latest.filter(
              row => row.device.provider === provider
            ),

            energy: data.energy.filter(
              row => row.provider === provider
            ),
          },
          now
        ),

        ...(provider === 'hyxi'
          ? summarizeHyxiDevices(providerDevices)
          : {}),
      };
    }),
  };
}

function summarize(
  {
    plants,
    devices,
    latest,
    energy,
  },
  now
) {
  const electrical = latest.filter(
    row => row.device.device_type !== 'COLLECTOR'
  );

  const fresh = electrical.filter(
    row =>
      telemetryFreshness(
        row.collected_at,
        now
      ).data_status === 'fresh'
  );

  /*
   * Si una planta ya tiene resumen energético,
   * ese resumen tiene prioridad.
   */
  const summarized = new Set(
    energy
      .filter(
        row => row.today_generation_kwh != null
      )
      .map(row => row.plant_id)
  );

  /*
   * Fallback de energía diaria desde device_latest_data.
   *
   * Para Growatt solo aceptamos today_energy cuando
   * la telemetría pertenece al día actual de Bolivia.
   *
   * Esto evita sumar el contador acumulado del día
   * anterior cuando un inversor está offline.
   */
  const fallback = electrical.filter(row => {
    if (summarized.has(row.device.plant_id)) {
      return false;
    }

    if (row.device.provider === 'growatt') {
      return isSameCalendarDay(
        growattEffectiveTimestamp(row),
        row.device.plant?.timezone ?? 'UTC',
        now,
      );
    }

    return true;
  });

  const latestById = new Map(
    latest.map(row => [row.device_id, row])
  );

  const growattStateEquals = (device, state) =>
    device.provider === 'growatt'
      ? growattDeviceState(
          latestById.get(device.id),
          now
        ) === state
      : device.status === state;

  /*
   * Telemetría por dispositivo: Actual / Desactualizada /
   * Sin datos. El universo es el total de dispositivos.
   */
  const telemetry = devices.reduce(
    (counts, device) => {
      const status = telemetryFreshness(
        telemetryTimestamp(
          latestById.get(device.id)
        ),
        now,
      ).data_status;

      if (status === 'fresh') counts.current += 1;
      else if (status === 'stale') counts.stale += 1;
      else counts.no_data += 1;

      return counts;
    },
    { current: 0, stale: 0, no_data: 0 },
  );

  /*
   * Producción de hoy por planta: cada planta se suma
   * desde su resumen energético o desde el fallback de
   * telemetría. La suma resultante coincide con
   * today_generation_kwh.
   */
  const todayByPlant = new Map();

  for (const row of energy) {
    const value = Number(row.today_generation_kwh);

    if (Number.isFinite(value)) {
      todayByPlant.set(
        row.plant_id,
        (todayByPlant.get(row.plant_id) ?? 0) + value
      );
    }
  }

  for (const row of fallback) {
    const plantId = row.device.plant_id;
    const value = Number(row.today_energy ?? 0);

    if (Number.isFinite(value)) {
      todayByPlant.set(
        plantId,
        (todayByPlant.get(plantId) ?? 0) + value
      );
    }
  }

  const topPlants = plants
    .map(plant => ({
      plant,
      today: todayByPlant.get(plant.id),
    }))
    .filter(
      item => item.today != null
        && Number.isFinite(item.today)
    )
    .sort((a, b) => b.today - a.today)
    .slice(0, 5)
    .map(({ plant, today }) => ({
      plant_id: plant.id,
      name: plant.name ?? plant.id,
      provider: plant.provider,
      today_generation_kwh:
        Number(today.toFixed(2)),
    }));

  return {
    total_plants: plants.length,

    online_plants:
      plants.filter(
        plant => plant.status === 'online'
      ).length,

    offline_plants:
      plants.filter(
        plant => plant.status === 'offline'
      ).length,

    alarm_plants:
      plants.filter(
        plant => plant.status === 'alarm'
      ).length,

    unknown_plants:
      plants.filter(
        plant => plant.status === 'unknown'
      ).length,

    telemetry_current:
      telemetry.current,

    telemetry_stale:
      telemetry.stale,

    telemetry_no_data:
      telemetry.no_data,

    total_capacity_kwp:
      sum(plants, 'capacity_kwp'),

    total_devices:
      devices.length,

    inverter_devices:
      devices.filter(device =>
        [
          'STRING_INVERTER',
          'HYBRID_INVERTER',
        ].includes(device.device_type)
      ).length,

    communication_devices:
      devices.filter(
        device =>
          device.device_type === 'COLLECTOR'
      ).length,

    online_devices:
      devices.filter(
        device =>
          growattStateEquals(device, 'online')
      ).length,

    unknown_devices:
      devices.filter(
        device =>
          device.provider === 'growatt'
            ? growattStateEquals(device, 'unknown')
            : !['online', 'offline']
              .includes(device.status)
      ).length,

    current_generation_power_w:
      sum(fresh, 'ac_power'),

    current_consumption_power_w:
      sum(fresh, 'load_power'),

    current_grid_import_power_w:
      sum(fresh, 'grid_import_power'),

    current_grid_export_power_w:
      sum(fresh, 'grid_export_power'),

    current_battery_charge_power_w:
      sum(fresh, 'battery_charge_power'),

    current_battery_discharge_power_w:
      sum(fresh, 'battery_discharge_power'),

    today_generation_kwh:
      Number(
        (
          sum(
            energy,
            'today_generation_kwh'
          )
          + sum(
            fallback,
            'today_energy'
          )
        ).toFixed(2)
      ),

    month_generation_kwh:
      sum(
        energy,
        'month_generation_kwh'
      ),

    year_generation_kwh:
      sum(
        energy,
        'year_generation_kwh'
      ),

    total_generation_kwh:
      sum(
        energy,
        'total_generation_kwh'
      ),

    top_plants:
      topPlants,

    today_consumption_kwh:
      sum(
        energy,
        'today_consumption_kwh'
      ),

    active_devices:
      devices.length,

    offline_devices:
      devices.filter(
        device =>
          growattStateEquals(device, 'offline')
      ).length,
  };
}