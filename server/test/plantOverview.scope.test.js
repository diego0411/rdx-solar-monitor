import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

const supportsModuleMocks = typeof mock.module === 'function';

const PLANT_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const PLANT_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

const now = Date.now();
const collectedAt = new Date(now - 1 * 60 * 1000).toISOString();

const calls = {
  plants: [],
  devices: [],
  latest: [],
  summaries: [],
};

if (supportsModuleMocks) {
  mock.module('../src/repositories/plants.repository.js', {
    namedExports: {
      listStoredPlants: async plantIds => {
        calls.plants.push(plantIds);
        return [
          {
            id: PLANT_A,
            provider: 'hyxi',
            active: true,
            status: 'online',
            name: 'Planta A',
            external_plant_id: 'ext-a',
            capacity_kwp: 10,
            timezone: 'UTC',
          },
          {
            id: PLANT_B,
            provider: 'hyxi',
            active: true,
            status: 'online',
            name: 'Planta B',
            external_plant_id: 'ext-b',
            capacity_kwp: 99,
            timezone: 'UTC',
          },
        ];
      },
    },
  });

  mock.module('../src/repositories/devices.repository.js', {
    namedExports: {
      listStoredDevices: async plantIds => {
        calls.devices.push(plantIds);
        return [
          {
            id: 'd1', plant_id: PLANT_A, provider: 'hyxi', active: true, status: 'online', device_type: 'INVERTER',
          },
          {
            id: 'd2', plant_id: PLANT_B, provider: 'hyxi', active: true, status: 'online', device_type: 'INVERTER',
          },
        ];
      },
    },
  });

  mock.module('../src/repositories/deviceLatestData.repository.js', {
    namedExports: {
      listDeviceLatestData: async plantIds => {
        calls.latest.push(plantIds);
        return [
          {
            device_id: 'd1', device_type: 'INVERTER', ac_power: 100, load_power: 50, collected_at: collectedAt, updated_at: collectedAt,
          },
          {
            device_id: 'd2', device_type: 'INVERTER', ac_power: 900, load_power: 500, collected_at: collectedAt, updated_at: collectedAt,
          },
        ];
      },
    },
  });

  mock.module('../src/repositories/plantEnergySummary.repository.js', {
    namedExports: {
      listPlantEnergySummaries: async plantIds => {
        calls.summaries.push(plantIds);
        return [
          { plant_id: PLANT_A, today_generation_kwh: 10 },
          { plant_id: PLANT_B, today_generation_kwh: 999 },
        ];
      },
    },
  });
}

const { getPlantOverview } = supportsModuleMocks
  ? await import('../src/services/plantsOverview.service.js')
  : {};

function scopeOf(received) {
  assert.ok(received instanceof Set, 'el repository debe recibir un Set de scope');
  return [...received];
}

test('overview solicita datos scoped a la planta pedida', { skip: !supportsModuleMocks }, async () => {
  await getPlantOverview(PLANT_A);
  assert.deepEqual(scopeOf(calls.plants.at(-1)), [PLANT_A]);
  assert.deepEqual(scopeOf(calls.devices.at(-1)), [PLANT_A]);
  assert.deepEqual(scopeOf(calls.latest.at(-1)), [PLANT_A]);
  assert.deepEqual(scopeOf(calls.summaries.at(-1)), [PLANT_A]);
});

test('overview no mezcla datos de otra planta y mantiene shape', { skip: !supportsModuleMocks }, async () => {
  const overview = await getPlantOverview(PLANT_A);

  assert.equal(overview.plant.id, PLANT_A);
  assert.equal(overview.plant.name, 'Planta A');
  // Solo el device de A sobrevive al filtro (red de seguridad).
  assert.deepEqual(overview.devices.map(device => device.id), ['d1']);
  // Sumas solo con telemetría de A (B aportaría 900).
  assert.equal(overview.realtime.current_ac_power_w, 100);
  assert.equal(overview.realtime.load_power, 50);
  // Resumen energético de A, no de B.
  assert.equal(overview.energy.today_generation_kwh, 10);
  // Shape top-level intacto.
  for (const key of ['plant', 'energy', 'realtime', 'devices']) {
    assert.ok(key in overview, `falta sección ${key}`);
  }
});

test('overview normaliza el id para el scope', { skip: !supportsModuleMocks }, async () => {
  const overview = await getPlantOverview(PLANT_A.toUpperCase());
  assert.equal(overview.plant.id, PLANT_A);
  assert.deepEqual(scopeOf(calls.plants.at(-1)), [PLANT_A]);
});

test('planta desconocida retorna null (ruta 404 preservada)', { skip: !supportsModuleMocks }, async () => {
  const overview = await getPlantOverview('cccccccc-3333-4333-8333-cccccccccccc');
  assert.equal(overview, null);
});
