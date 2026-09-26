import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

const supportsModuleMocks = typeof mock.module === 'function';

const now = Date.now();
const collectedAt = new Date(now - 1 * 60 * 1000).toISOString();

if (supportsModuleMocks) {
  mock.module('../src/repositories/plants.repository.js', {
    namedExports: {
      listStoredPlants: async () => [
        {
          id: 'p1',
          provider: 'growatt',
          active: true,
          status: 'online',
          name: 'Planta A',
          external_plant_id: 'ext-1',
          capacity_kwp: 10,
          timezone: 'UTC',
        },
      ],
    },
  });

  mock.module('../src/repositories/devices.repository.js', {
    namedExports: {
      listStoredDevices: async () => [
        {
          id: 'd1',
          plant_id: 'p1',
          provider: 'growatt',
          active: true,
          status: 'online',
          device_type: 'MIN',
        },
      ],
    },
  });

  mock.module('../src/repositories/deviceLatestData.repository.js', {
    namedExports: {
      listDeviceLatestData: async () => [
        {
          device_id: 'd1',
          device_type: 'MIN',
          pv_power: 5419.6,
          ac_power: 5193.79,
          collected_at: collectedAt,
          updated_at: collectedAt,
        },
      ],
    },
  });

  mock.module('../src/repositories/plantEnergySummary.repository.js', {
    namedExports: {
      listPlantEnergySummaries: async () => [],
    },
  });
}

const { getPlantsOverview } = supportsModuleMocks
  ? await import('../src/services/plantsOverview.service.js')
  : {};

test('current_power_w usa ac_power (pac), no pv_power (ppv)', { skip: !supportsModuleMocks }, async () => {
  const overview = await getPlantsOverview(null);

  assert.equal(overview.length, 1);
  assert.equal(overview[0].current_power_w, 5193.79);
});
