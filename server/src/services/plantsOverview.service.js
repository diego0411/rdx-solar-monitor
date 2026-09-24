import { listStoredPlants } from '../repositories/plants.repository.js';
import { listStoredDevices } from '../repositories/devices.repository.js';
import { listDeviceLatestData } from '../repositories/deviceLatestData.repository.js';
import { listPlantEnergySummaries } from '../repositories/plantEnergySummary.repository.js';
import { latestPlantConsumption } from '../repositories/plantPowerIntervals.repository.js';
import { telemetryFreshness } from './telemetryFreshness.js';
import { resolvePlantLoadPower } from './plantLoadPower.service.js';
import {
  isSameCalendarDay,
  growattDeviceState,
} from '../providers/growatt/growattStates.js';

function rounded(value) {
  if (value == null) return null;

  const number = Number(value);

  return Number.isFinite(number)
    ? Number(number.toFixed(2))
    : null;
}

function hasElectricalMetric(row) {
  return row.device_type !== 'COLLECTOR'
    && [
      'pv_power',
      'ac_power',
      'load_power',
      'grid_power',
      'grid_import_power',
      'grid_export_power',
      'battery_power',
      'battery_charge_power',
      'battery_discharge_power',
    ].some(
      key =>
        row[key] != null
        && Number.isFinite(Number(row[key])),
    );
}

function latestTimestamp(values) {
  return values
    .filter(
      value =>
        value
        && Number.isFinite(Date.parse(value)),
    )
    .sort(
      (a, b) =>
        Date.parse(b) - Date.parse(a),
    )[0] ?? null;
}

function growattEffectiveTimestamp(row) {
  return row?.collected_at
    ?? row?.updated_at
    ?? null;
}

function currentGrowattRows(rows, timezone, now) {
  return rows.filter(
    row =>
      isSameCalendarDay(
        growattEffectiveTimestamp(row),
        timezone,
        now,
      ),
  );
}

function summarizeHyxiDevices(
  devices,
  latestCollectedAt,
  plantLastSyncedAt,
) {
  const inverters = devices.filter(
    device =>
      [
        'STRING_INVERTER',
        'HYBRID_INVERTER',
      ].includes(device.device_type),
  );

  const communication = devices.filter(
    device =>
      device.device_type === 'COLLECTOR',
  );

  return {
    inverter_total: inverters.length,

    inverter_online:
      inverters.filter(
        device => device.status === 'online',
      ).length,

    inverter_offline:
      inverters.filter(
        device => device.status === 'offline',
      ).length,

    inverter_alarm:
      inverters.filter(
        device => device.status === 'alarm',
      ).length,

    communication_total: communication.length,

    communication_online:
      communication.filter(
        device => device.status === 'online',
      ).length,

    communication_offline:
      communication.filter(
        device => device.status === 'offline',
      ).length,

    communication_alarm:
      communication.filter(
        device => device.status === 'alarm',
      ).length,

    latest_collected_at: latestCollectedAt,

    latest_synced_at: latestTimestamp([
      plantLastSyncedAt,
      ...devices.map(
        device => device.last_synced_at,
      ),
    ]),
  };
}

export async function getPlantOverview(plantId) {
  const plant = (await listStoredPlants())
    .find(
      row =>
        row.id === plantId.toLowerCase(),
    );

  if (!plant) {
    return null;
  }

  const [
    allDevices,
    allLatest,
    summaries,
  ] = await Promise.all([
    listStoredDevices(),
    listDeviceLatestData(),
    listPlantEnergySummaries(),
  ]);

  const devices = allDevices.filter(
    device =>
      device.plant_id === plant.id,
  );

  const ids = new Set(
    devices.map(device => device.id),
  );

  const latest = allLatest.filter(
    row =>
      ids.has(row.device_id),
  );

  const latestById = new Map(
    latest.map(
      row => [row.device_id, row],
    ),
  );

  const electrical = latest.filter(
    row =>
      row.device_type !== 'COLLECTOR',
  );

  const sum = (rows, key) => {
    const values = rows.filter(
      row =>
        row[key] != null
        && Number.isFinite(Number(row[key])),
    );

    return values.length
      ? rounded(
        values.reduce(
          (total, row) =>
            total + Number(row[key]),
          0,
        ),
      )
      : null;
  };

  const growattInverterLatest = devices
    .filter(
      device =>
        device.provider === 'growatt'
        && device.active === true
        && String(device.device_type).toUpperCase() === 'MIN',
    )
    .map(
      device =>
        latestById.get(device.id),
    )
    .filter(Boolean);

  const growattTodayLatest =
    currentGrowattRows(
      growattInverterLatest,
      plant.timezone ?? 'UTC',
    );

  const deviceById = new Map(
    devices
      .filter(device => device.active === true)
      .map(device => [device.id, device]),
  );

  const lastDataAt = latestTimestamp(
    latest.flatMap(row => {
      const device = deviceById.get(row.device_id);
      if (!device) return [];
      const candidate = row.collected_at
        ?? (device.provider === 'growatt' ? row.updated_at : null);
      return candidate ? [candidate] : [];
    }),
  );

  const energy = summaries.find(
    row =>
      row.plant_id === plant.id,
  );

  const freshness =
    telemetryFreshness(lastDataAt);

  /*
   * Solo cuando no hay ninguna lectura conocida se
   * descartan las métricas eléctricas.
   *
   * fresh/stale => últimos valores conocidos.
   * no_data => null
   */
  const knownElectrical =
    freshness.data_status === 'no_data'
      ? []
      : electrical;

  const soc = knownElectrical.filter(
    row =>
      row.battery_soc != null
      && Number.isFinite(Number(row.battery_soc)),
  );

  const deviceLoadPower = sum(
    knownElectrical,
    'load_power',
  );

  const latestConsumption =
    plant.provider === 'hyxi'
      && deviceLoadPower == null
      ? await latestPlantConsumption(plant.id)
      : null;

  const loadPowerResolved = resolvePlantLoadPower({
    deviceLoadPower,
    latestConsumption,
    provider: plant.provider,
  });

  return {
    plant: {
      ...Object.fromEntries(
        [
          'id',
          'external_plant_id',
          'name',
          'provider',
          'status',
          'plant_type',
          'timezone',
          'address',
        ].map(
          key =>
            [key, plant[key] ?? null],
        ),
      ),

      capacity_kwp:
        rounded(plant.capacity_kwp),

      latitude:
        rounded(plant.latitude),

      longitude:
        rounded(plant.longitude),

      last_data_at:
        lastDataAt,

      platform_created_at:
        plant.provider === 'growatt'
          ? plant.metadata?.create_date ?? null
          : null,
    },

    energy: {
      ...Object.fromEntries(
        [
          'today_generation_kwh',
          'month_generation_kwh',
          'year_generation_kwh',
          'total_generation_kwh',
          'today_consumption_kwh',
          'month_consumption_kwh',
          'year_consumption_kwh',
          'total_consumption_kwh',
        ].map(
          key =>
            [key, rounded(energy?.[key])],
        ),
      ),

      ...(plant.provider === 'growatt'
        ? {
          today_generation_kwh:
            sum(
              growattTodayLatest,
              'today_energy',
            ),

          total_generation_kwh:
            sum(
              growattInverterLatest,
              'total_energy',
            ),
        }
        : {}),
    },

    realtime: {
      ...freshness,

      pv_power:
        sum(knownElectrical, 'pv_power'),

      ac_power:
        sum(knownElectrical, 'ac_power'),

      load_power:
        loadPowerResolved.load_power,

      load_power_at:
        loadPowerResolved.load_power_at,

      grid_import_power:
        sum(
          knownElectrical,
          'grid_import_power',
        ),

      grid_export_power:
        sum(
          knownElectrical,
          'grid_export_power',
        ),

      battery_charge_power:
        sum(
          knownElectrical,
          'battery_charge_power',
        ),

      battery_discharge_power:
        sum(
          knownElectrical,
          'battery_discharge_power',
        ),

      current_pv_power_w:
        sum(knownElectrical, 'pv_power'),

      current_ac_power_w:
        sum(knownElectrical, 'ac_power'),

      current_grid_power:
        sum(knownElectrical, 'grid_power'),

      battery_power_w:
        sum(
          knownElectrical.filter(
            row =>
              row.device_type?.includes('INVERTER'),
          ),
          'battery_power',
        ),

      battery_soc:
        soc.length
          ? rounded(
            soc.reduce(
              (total, row) =>
                total + Number(row.battery_soc),
              0,
            ) / soc.length,
          )
          : null,
    },

    devices: devices
      .sort(
        (a, b) =>
          (a.device_type ?? '').localeCompare(
            b.device_type ?? '',
          )
          || (a.name ?? '').localeCompare(
            b.name ?? '',
          )
          || a.id.localeCompare(b.id),
      )
      .map(
        device => ({
          ...Object.fromEntries(
            [
              'id',
              'provider',
              'serial_number',
              'name',
              'model',
              'device_type',
              'status',
              'software_version',
              'hardware_version',
            ].map(
              key =>
                [key, device[key] ?? null],
            ),
          ),

          rated_power_w:
            rounded(device.rated_power_w),

          last_data_at:
            latestById.get(device.id)?.collected_at
            ?? device.last_data_at
            ?? null,
        }),
      ),
  };
}

export async function getPlantsOverview(plantIds = null) {
  const [
    plants,
    devices,
    latest,
    summaries,
  ] = await Promise.all([
    listStoredPlants(plantIds),
    listStoredDevices(plantIds),
    listDeviceLatestData(plantIds),
    listPlantEnergySummaries(plantIds),
  ]);

  const devicesById = new Map(
    devices.map(
      device => [device.id, device],
    ),
  );

  const latestByDeviceId = new Map(
    latest.map(
      row => [row.device_id, row],
    ),
  );

  const activeDevicesByPlant = new Map();

  for (
    const device of devices.filter(
      device => device.active === true,
    )
  ) {
    const stored =
      activeDevicesByPlant.get(device.plant_id)
      ?? [];

    stored.push(device);

    activeDevicesByPlant.set(
      device.plant_id,
      stored,
    );
  }

  const energyByPlant = new Map(
    summaries.map(
      summary =>
        [summary.plant_id, summary],
    ),
  );

  const telemetryByPlant = new Map();
  const now = Date.now();

  for (const row of latest) {
    const device =
      devicesById.get(row.device_id);

    if (!device) {
      continue;
    }

    const electricalMetric =
      hasElectricalMetric(row);

    const effectiveLastDataAt =
      row.collected_at
      ?? (
        device.provider === 'growatt'
        && electricalMetric
          ? row.updated_at
          : null
      );

    const aggregate =
      telemetryByPlant.get(device.plant_id)
      ?? {
        power: 0,
        lastDataAt: null,
        electricalLastDataAt: null,
        electricalHasFresh: false,
      };

    const power =
      Number(row.pv_power ?? 0);

    if (
      device.device_type !== 'COLLECTOR'
      && Number.isFinite(power)
    ) {
      aggregate.power += power;
    }

    if (
      effectiveLastDataAt
      && Number.isFinite(
        Date.parse(effectiveLastDataAt),
      )
      && (
        aggregate.lastDataAt === null
        || Date.parse(effectiveLastDataAt)
          > Date.parse(aggregate.lastDataAt)
      )
    ) {
      aggregate.lastDataAt =
        effectiveLastDataAt;
    }

    if (
      electricalMetric
      && effectiveLastDataAt
      && Number.isFinite(
        Date.parse(effectiveLastDataAt),
      )
      && (
        aggregate.electricalLastDataAt === null
        || Date.parse(effectiveLastDataAt)
          > Date.parse(
            aggregate.electricalLastDataAt,
          )
      )
    ) {
      aggregate.electricalLastDataAt =
        effectiveLastDataAt;
    }

    if (
      electricalMetric
      && telemetryFreshness(
        effectiveLastDataAt,
        now,
      ).data_status === 'fresh'
    ) {
      aggregate.electricalHasFresh = true;
    }

    telemetryByPlant.set(
      device.plant_id,
      aggregate,
    );
  }

  return plants
    .filter(
      plant =>
        plant.active === true,
    )
    .map(plant => {
      const energy =
        energyByPlant.get(plant.id);

      const telemetry =
        telemetryByPlant.get(plant.id);

      const freshness =
        telemetryFreshness(
          telemetry?.electricalLastDataAt ?? null,
          now,
        );

      const plantDevices =
        activeDevicesByPlant.get(plant.id)
        ?? [];

      const growattInverterLatest =
        plantDevices
          .filter(
            device =>
              device.provider === 'growatt'
              && String(
                device.device_type,
              ).toUpperCase() === 'MIN',
          )
          .map(
            device =>
              latestByDeviceId.get(device.id),
          )
          .filter(Boolean);

      const growattTodayLatest =
        currentGrowattRows(
          growattInverterLatest,
          plant.timezone ?? 'UTC',
          now,
        );

      const growattInverters =
        plantDevices.filter(
          device =>
            device.provider === 'growatt'
            && String(
              device.device_type,
            ).toUpperCase() === 'MIN',
        );

      const sumGrowattValue = (
        rows,
        getter,
      ) => {
        const values = rows
          .map(getter)
          .filter(
            value =>
              value !== null
              && value !== undefined
              && String(value).trim() !== ''
              && Number.isFinite(Number(value)),
          );

        return values.length
          ? rounded(
            values.reduce(
              (total, value) =>
                total + Number(value),
              0,
            ),
          )
          : null;
      };

      /*
       * Potencia actual:
       * solo se expone cuando existe telemetría fresca.
       */
      const currentPower =
        telemetry?.electricalHasFresh
          ? rounded(telemetry.power)
          : null;

      return {
        id: plant.id,

        external_plant_id:
          plant.external_plant_id,

        name:
          plant.name,

        provider:
          plant.provider,

        status:
          plant.status,

        capacity_kwp:
          rounded(plant.capacity_kwp),

        current_power_w:
          currentPower,

        today_generation_kwh:
          plant.provider === 'growatt'
            ? sumGrowattValue(
              growattTodayLatest,
              row => row.today_energy,
            )
            : rounded(
              energy?.today_generation_kwh,
            ),

        today_consumption_kwh:
          plant.provider === 'growatt'
            ? sumGrowattValue(
              growattTodayLatest,
              row =>
                row.raw_data?.elocalLoadToday,
            )
            : rounded(
              energy?.today_consumption_kwh,
            ),

        last_data_at:
          telemetry?.lastDataAt ?? null,

        ...freshness,

        data_status:
          telemetry?.electricalHasFresh
            ? 'fresh'
            : freshness.data_status,

        ...(plant.provider === 'hyxi'
          ? summarizeHyxiDevices(
            plantDevices,
            telemetry?.lastDataAt ?? null,
            plant.last_synced_at,
          )
          : plant.provider === 'growatt'
            ? {
              inverter_total:
                growattInverters.length,

              inverter_online:
                growattInverters.filter(
                  device =>
                    growattDeviceState(
                      latestByDeviceId.get(
                        device.id,
                      ),
                      now,
                    ) === 'online',
                ).length,

              inverter_offline:
                growattInverters.filter(
                  device =>
                    growattDeviceState(
                      latestByDeviceId.get(
                        device.id,
                      ),
                      now,
                    ) === 'offline',
                ).length,

              inverter_alarm:
                growattInverters.filter(
                  device =>
                    growattDeviceState(
                      latestByDeviceId.get(
                        device.id,
                      ),
                      now,
                    ) === 'alarm',
                ).length,

              inverter_unknown:
                growattInverters.filter(
                  device =>
                    growattDeviceState(
                      latestByDeviceId.get(
                        device.id,
                      ),
                      now,
                    ) === 'unknown',
                ).length,
            }
            : {}),
      };
    });
}
