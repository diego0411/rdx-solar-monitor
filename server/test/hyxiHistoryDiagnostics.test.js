import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

// IMPORTANTE: sin imports estáticos de código bajo mock. Todo lo mockeado
// se importa dinámicamente DESPUÉS de registrar los mocks.
// Sin llamadas reales HYXi ni BD: fabricante y repositorios están mockeados.

import { describeHyxiHistoryShape, withHistoryShape } from '../src/providers/hyxi/hyxiHistoryShape.js';

test('descriptor: respuestas sin datos solo describen forma', () => {
  assert.deepEqual(describeHyxiHistoryShape(undefined), {
    has_data: false, data_type: 'undefined', has_time_point: false, time_point_type: 'undefined',
  });
  assert.deepEqual(describeHyxiHistoryShape({ success: true, code: '0', data: null }), {
    has_data: false, data_type: 'null', has_time_point: false, time_point_type: 'undefined',
  });
  assert.deepEqual(describeHyxiHistoryShape({ success: true, code: '0', data: {} }), {
    has_data: true, data_type: 'object', has_time_point: false, time_point_type: 'undefined',
  });
  assert.deepEqual(describeHyxiHistoryShape({ data: { timePoint: null } }), {
    has_data: true, data_type: 'object', has_time_point: false, time_point_type: 'null',
  });
});

test('descriptor: timePoint arreglo informa longitud; otro tipo solo su tipo', () => {
  assert.deepEqual(describeHyxiHistoryShape({ data: { timePoint: [] } }), {
    has_data: true, data_type: 'object', has_time_point: true, time_point_type: 'array', time_point_length: 0,
  });
  assert.deepEqual(describeHyxiHistoryShape({ data: { timePoint: [1, 2] } }), {
    has_data: true, data_type: 'object', has_time_point: true, time_point_type: 'array', time_point_length: 2,
  });
  assert.deepEqual(describeHyxiHistoryShape({ data: { timePoint: 'x' } }), {
    has_data: true, data_type: 'object', has_time_point: true, time_point_type: 'string',
  });
});

test('descriptor nunca expone valores energéticos ni payloads', () => {
  const shape = describeHyxiHistoryShape({
    success: true, code: '0', token: 'secreto',
    data: { timePoint: [1750000000], timeZone: 'America/La_Paz', yield: [10.5], secret: 'x' },
  });
  const serialized = JSON.stringify(shape);
  for (const leak of ['1750000000', '10.5', 'secreto', 'La_Paz', 'yield', 'secret']) {
    assert.ok(!serialized.includes(leak), `fuga detectada: ${leak}`);
  }
  assert.deepEqual(shape, {
    has_data: true, data_type: 'object', has_time_point: true, time_point_type: 'array', time_point_length: 1,
  });
});

test('withHistoryShape conserva mensaje y no pisa descriptor previo', () => {
  const error = new Error('Invalid HYXi energy history');
  withHistoryShape(error, { data: null });
  assert.equal(error.message, 'Invalid HYXi energy history');
  assert.deepEqual(error.historyShape, {
    has_data: false, data_type: 'null', has_time_point: false, time_point_type: 'undefined',
  });
  withHistoryShape(error, { data: { timePoint: [1] } });
  assert.deepEqual(error.historyShape.has_data, false);
  assert.equal(withHistoryShape(null, { data: null }), null);
});

// ---- Provider: adjunta forma sin cambiar clasificación ----

let postImpl = async () => ({ success: true, code: '0', data: { timePoint: [] } });

mock.module('../src/providers/hyxi/hyxiClient.js', {
  namedExports: { hyxiClient: { post: async (...args) => postImpl(...args) } },
});

const { HyxiProvider } = await import('../src/providers/hyxi/HyxiProvider.js');
const provider = new HyxiProvider();

test('energy data:null sigue inválido pero adjunta forma', async () => {
  postImpl = async () => ({ success: true, code: '0', data: null });
  const error = await provider.getPlantEnergyHistory('Pl1', 1, '2026-10-05').then(
    () => null, failure => failure,
  );
  assert.match(error.message, /Invalid HYXi energy history/);
  assert.deepEqual(error.historyShape, {
    has_data: false, data_type: 'null', has_time_point: false, time_point_type: 'undefined',
  });
});

test('energy con gate success/code fallido también adjunta forma', async () => {
  postImpl = async () => ({ success: false, code: '1', data: null });
  const error = await provider.getPlantEnergyHistory('Pl1', 1, '2026-10-05').then(
    () => null, failure => failure,
  );
  assert.match(error.message, /Invalid HYXi plant energy history response/);
  assert.equal(error.historyShape.has_data, false);
});

test('energy válido sigue normalizando sin descriptor', async () => {
  postImpl = async () => ({
    success: true, code: '0',
    data: {
      timePoint: [1750000000], timeZone: 'America/La_Paz',
      yield: [1], consume: [2], charged: [null], discharged: [null], buyYield: [3], sellYield: [4],
    },
  });
  const history = await provider.getPlantEnergyHistory('Pl1', 1, '2026-10-05');
  assert.equal(history.points.length, 1);
  assert.equal(history.points[0].generation_kwh, 1);
});

test('power con gate fallido adjunta forma', async () => {
  postImpl = async () => ({ success: true, code: '9', data: { timePoint: [] } });
  const error = await provider.getPlantPowerHistory('Pl1', '2026-10-05').then(
    () => null, failure => failure,
  );
  assert.match(error.message, /Invalid HYXi plant power history response/);
  assert.deepEqual(error.historyShape.time_point_length, 0);
});

// ---- Servicio power: adjunta forma al fallar normalización ----

class FakePowerProvider {
  async getPlantPowerHistory() {
    return { success: true, code: '0', data: null };
  }
}

mock.module('../src/providers/hyxi/HyxiProvider.js', {
  namedExports: { HyxiProvider: FakePowerProvider },
});
mock.module('../src/repositories/energyIntervals.repository.js', {
  namedExports: {
    resolveHyxiPlant: async () => 'plant-1',
    upsertEnergyIntervals: async () => { throw new Error('no debería ejecutarse'); },
    listEnergyIntervalsRange: async () => [],
  },
});
mock.module('../src/repositories/plantPowerIntervals.repository.js', {
  namedExports: {
    upsertPlantPowerIntervals: async () => { throw new Error('no debería ejecutarse'); },
    listPlantPowerIntervals: async () => [],
  },
});

const { syncHyxiPowerHistory } = await import('../src/services/hyxiPowerHistory.service.js');

test('power data:null inválido, sin escritura y con forma', async () => {
  const error = await syncHyxiPowerHistory('Pl2106120704377393152', '2026-10-05').then(
    () => null, failure => failure,
  );
  assert.match(error.message, /Invalid HYXi power history/);
  assert.deepEqual(error.historyShape, {
    has_data: false, data_type: 'null', has_time_point: false, time_point_type: 'undefined',
  });
});

// ---- Ciclo: continuidad por planta + resumen (nunca undefined) ----

const shapeOf = kind => ({
  has_data: false, data_type: 'null', has_time_point: false, time_point_type: kind,
});
const normError = message => {
  const error = new Error(message);
  error.historyShape = shapeOf('undefined');
  return error;
};

const plants = [
  { id: 'p1', external_plant_id: 'PlFAIL', timezone: 'America/La_Paz' },
  { id: 'p2', external_plant_id: 'PlOK', timezone: 'America/La_Paz' },
  { id: 'p3', external_plant_id: 'PlDEGRADED', timezone: 'America/La_Paz' },
];

const powerCalls = [];
const energyCalls = [];

mock.module('../src/repositories/plants.repository.js', {
  namedExports: { listActiveHyxiPlants: async () => plants },
});
mock.module('../src/services/hyxiPowerHistory.service.js', {
  namedExports: {
    localDateForTimezone: () => '2026-10-05',
    syncHyxiPowerHistoryWindow: async plant => {
      powerCalls.push(plant.external_plant_id);
      if (plant.external_plant_id === 'PlFAIL') {
        return {
          current: null, closure: null,
          errors: [{ period: 'current', date: '2026-10-05', error: normError('Invalid HYXi power history') }],
        };
      }
      if (plant.external_plant_id === 'PlDEGRADED') {
        return {
          current: { fetched: 2, upserted: 0, failed: 2 }, closure: { skipped: true }, errors: [],
        };
      }
      return {
        current: { fetched: 1, upserted: 1, failed: 0 }, closure: { skipped: true }, errors: [],
      };
    },
  },
});
mock.module('../src/services/hyxiEnergyHistory.service.js', {
  namedExports: {
    syncHyxiEnergyHistory: async externalPlantId => {
      energyCalls.push(externalPlantId);
      if (externalPlantId === 'PlFAIL') throw normError('Invalid HYXi energy history');
      return { fetched: 1, upserted: 1, failed: 0 };
    },
  },
});

const { syncHyxiHistoryCycle } = await import('../src/services/hyxiHistoryCycle.service.js');

test('el ciclo continúa ante fallos y devuelve resumen con formas seguras', async () => {
  const logs = [];
  const logger = { error: (...args) => { logs.push(args); }, info: () => {}, warn: () => {} };
  const summary = await syncHyxiHistoryCycle({ logger });

  assert.deepEqual(powerCalls, ['PlFAIL', 'PlOK', 'PlDEGRADED']);
  assert.deepEqual(energyCalls, ['PlFAIL', 'PlOK', 'PlDEGRADED']);
  assert.deepEqual(summary, {
    plants: 3, power_failures: 2, energy_failures: 1, failed_plants: ['PlFAIL', 'PlDEGRADED'],
  });
  assert.notEqual(summary, undefined);

  const serialized = JSON.stringify(logs);
  assert.ok(serialized.includes('Invalid HYXi power history'));
  assert.ok(serialized.includes('Invalid HYXi energy history'));
  assert.ok(serialized.includes('has_time_point'));
  for (const leak of ['yield', 'consume', 'secreto']) {
    assert.ok(!serialized.includes(`"${leak}"`), `fuga detectada: ${leak}`);
  }
});

test('ciclo sin plantas devuelve resumen vacío sin errores', async () => {
  const logs = [];
  const logger = { error: (...args) => { logs.push(args); }, info: () => {}, warn: () => {} };
  const summary = await syncHyxiHistoryCycle({
    listPlants: async () => [], syncPowerWindow: async () => ({ errors: [] }), logger,
  });
  assert.deepEqual(summary, { plants: 0, power_failures: 0, energy_failures: 0, failed_plants: [] });
  assert.equal(logs.length, 0);
});
