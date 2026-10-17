import test from 'node:test';
import assert from 'node:assert/strict';

// Contrato de escalonamiento de server.js con timers simulados:
// primer inicio en el offset exacto, setInterval anclado al offset
// (segunda ejecución = offset + intervalo) y fases únicas módulo 300 s.

const FIRST_OFFSETS_MS = {
  growattLatest: 30_000,
  hyxiPlants: 60_000,
  hyxiDevices: 90_000,
  hyxiRealtime: 120_000,
  hyxiEnergySummary: 150_000,
  hyxiAlarms: 180_000,
  hyxiHistory: 210_000,
  growattHistory: 240_000,
  historyRollups: 270_000,
};

const STEP_MS = 30_000;
const GRID_MS = 300_000;

test('server escalona jobs periódicos sin alterar intervalos ni jobs sin escalonar', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 });
  for (const method of ['log', 'info', 'warn', 'error']) {
    t.mock.method(console, method, () => {});
  }

  const calls = {};
  const record = name => {
    calls[name] = [];
    return () => {
      calls[name].push(Date.now());
      return Promise.resolve();
    };
  };
  const noop = async () => {};
  const recordList = name => {
    calls[name] = [];
    return async () => {
      calls[name].push(Date.now());
      return [];
    };
  };

  t.mock.module('../src/app.js', { exports: { default: {
    listen(port, callback) { callback(); },
  } } });
  t.mock.module('../src/config/env.js', {
    exports: { env: { PORT: 0, ENABLE_SCHEDULERS: 'true' } },
  });
  t.mock.module('../src/services/growattPlants.service.js', {
    exports: { syncGrowattPlants: record('growattPlants') },
  });
  t.mock.module('../src/services/growattDiscoveryWorker.js', {
    exports: { startGrowattDiscoveryWorker: record('discovery') },
  });
  t.mock.module('../src/services/growattLatest.service.js', {
    exports: { syncGrowattLatest: record('growattLatest') },
  });
  t.mock.module('../src/services/growattPowerHistory.service.js', {
    exports: { syncGrowattPowerHistory: record('growattHistory') },
  });
  t.mock.module('../src/services/growattEnergyHistory.service.js', {
    exports: { syncGrowattEnergyHistory: noop, syncGrowattEnergyRollups: noop },
  });
  t.mock.module('../src/services/hyxiPlants.service.js', {
    exports: { syncHyxiPlants: record('hyxiPlants') },
  });
  t.mock.module('../src/services/hyxiDevices.service.js', {
    exports: { syncHyxiDevices: record('hyxiDevices') },
  });
  t.mock.module('../src/services/hyxiRealtime.service.js', {
    exports: { syncHyxiRealtime: record('hyxiRealtime') },
  });
  t.mock.module('../src/services/hyxiEnergySummary.service.js', {
    exports: { syncHyxiEnergySummary: record('hyxiEnergySummary') },
  });
  t.mock.module('../src/services/hyxiAlarmSync.service.js', {
    exports: { createHyxiAlarmSync: () => record('hyxiAlarms') },
  });
  t.mock.module('../src/services/hyxiHistoryCycle.service.js', {
    exports: { syncHyxiHistoryCycle: record('hyxiHistory') },
  });
  t.mock.module('../src/services/hyxiEnergyHistory.service.js', {
    exports: { syncHyxiEnergyHistory: noop },
  });
  t.mock.module('../src/repositories/plants.repository.js', {
    exports: {
      listActiveGrowattPlants: async () => [{ id: 'p1', external_plant_id: 'ext1' }],
      listActiveHyxiPlants: recordList('historyRollups'),
    },
  });

  const flush = () => new Promise(resolve => setImmediate(resolve));
  await import('../src/server.js');
  await flush();

  // t=0: solo los jobs sin escalonar arrancan de inmediato.
  assert.deepEqual(calls.growattPlants, [0], 'growattPlants arranca en t=0');
  assert.deepEqual(calls.discovery, [0], 'discovery arranca en t=0');
  for (const name of Object.keys(FIRST_OFFSETS_MS)) {
    assert.deepEqual(calls[name], [], `${name} no inicia antes de su offset`);
  }

  let now = 0;
  const advanceTo = async target => {
    while (now < target) {
      const step = Math.min(STEP_MS, target - now);
      t.mock.timers.tick(step);
      now += step;
      await flush();
    }
  };

  // Primeros inicios: cada job corre exactamente en su offset y ninguno antes.
  while (now < 270_000) {
    await advanceTo(now + STEP_MS);
    for (const [name, first] of Object.entries(FIRST_OFFSETS_MS)) {
      assert.deepEqual(calls[name], now >= first ? [first] : [], `${name} @${now} ms`);
    }
  }
  for (const [name, first] of Object.entries(FIRST_OFFSETS_MS)) {
    assert.deepEqual(calls[name], [first], `${name} arrancó exactamente en ${first} ms`);
  }

  // Intervalo anclado al offset: segunda ejecución = offset + intervalo.
  await advanceTo(600_000);
  assert.deepEqual(calls.growattLatest, [30_000, 330_000]);
  assert.deepEqual(calls.hyxiPlants, [60_000, 360_000]);
  assert.deepEqual(calls.hyxiDevices, [90_000, 390_000]);
  assert.deepEqual(calls.hyxiRealtime, [120_000, 420_000]);
  assert.deepEqual(calls.hyxiEnergySummary, [150_000, 450_000]);
  assert.deepEqual(calls.hyxiAlarms, [180_000, 480_000]);
  assert.deepEqual(calls.hyxiHistory, [210_000], 'hyxiHistory (10 min) aún sin segundo tick');
  assert.deepEqual(calls.growattHistory, [240_000], 'growattHistory (30 min) aún sin segundo tick');
  assert.deepEqual(calls.historyRollups, [270_000], 'rollups (6 h) aún sin segundo tick');

  await advanceTo(810_000);
  assert.deepEqual(calls.hyxiHistory, [210_000, 810_000], 'intervalo de 10 min preservado');

  await advanceTo(2_040_000);
  assert.deepEqual(calls.growattHistory, [240_000, 2_040_000], 'intervalo de 30 min preservado');

  await advanceTo(21_870_000);
  assert.deepEqual(calls.historyRollups, [270_000, 21_870_000], 'intervalo de 6 h preservado');

  // Los jobs sin escalonar no ganaron ticks (su autorreprogramación vive en sus servicios).
  assert.deepEqual(calls.growattPlants, [0]);
  assert.deepEqual(calls.discovery, [0]);

  // Requisitos de forma de los offsets: separación ~30 s y máximo 300 s.
  const offsets = Object.values(FIRST_OFFSETS_MS);
  for (let i = 1; i < offsets.length; i += 1) {
    assert.equal(offsets[i] - offsets[i - 1], STEP_MS, 'offsets separados 30 s');
  }
  assert.ok(Math.max(...offsets) <= GRID_MS, 'offsets <= 300 s');

  // Invariante global: cada job conserva su fase módulo 300 s en cada tick y
  // ninguna fase está compartida entre dos jobs (t=0 reservado a los sin escalonar).
  const ownerByPhase = new Map();
  for (const [name, timestamps] of Object.entries(calls)) {
    if (name === 'growattPlants' || name === 'discovery') continue;
    for (const ts of timestamps) {
      const phase = ts % GRID_MS;
      assert.equal(phase, FIRST_OFFSETS_MS[name] % GRID_MS, `${name} conserva su fase`);
      const owner = ownerByPhase.get(phase);
      if (owner) assert.equal(owner, name, `fase ${phase} compartida entre ${owner} y ${name}`);
      else ownerByPhase.set(phase, name);
    }
  }
  assert.equal(ownerByPhase.size, Object.keys(FIRST_OFFSETS_MS).length, '9 fases distintas');
  assert.ok(!ownerByPhase.has(0), 't=0 reservado para growattPlants y discovery');
});
