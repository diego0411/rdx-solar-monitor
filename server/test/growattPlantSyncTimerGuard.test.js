import test, { before, after, mock } from 'node:test';
import assert from 'node:assert/strict';

const supportsModuleMocks = typeof mock.module === 'function';

const captured = { plantWrites: [] };
const fsFiles = new Map();
const providerState = { users: [{ c_user_name: 'user1' }] };

const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const armedTimers = [];
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

function installSyncMocks() {
  mock.module('node:fs', {
    exports: {
      existsSync(path) { return fsFiles.has(String(path)); },
      readFileSync(path) { return fsFiles.get(String(path)) ?? '{}'; },
      mkdirSync() {},
      writeFileSync(path, content) { fsFiles.set(String(path), String(content)); },
    },
  });

  mock.module('../src/providers/growatt/GrowattProvider.js', {
    exports: {
      GrowattProvider: class {
        async listUsers() {
          return providerState.users;
        }
        async listUserPlants() {
          return [{ plant_id: '1001', name: 'Planta Granja', status: '4', peak_power: 5.5 }];
        }
        async plantDetails() {
          return {};
        }
      },
    },
  });

  mock.module('../src/repositories/plants.repository.js', {
    exports: {
      async getOrCreateGrowattAccount() { return { id: 'acc1' }; },
      async upsertGrowattPlant(plant) { captured.plantWrites.push(plant); return 'updated'; },
      async updateGrowattPlantDetail() {},
      async listGrowattPlantsByUser() { return []; },
      async updateGrowattPlantMetadata() {},
    },
  });
}

function installTimerSpy() {
  globalThis.setTimeout = (fn, delay) => {
    const handle = {
      fn,
      delay,
      cleared: false,
      fired: false,
      unref() { return handle; },
    };
    armedTimers.push(handle);
    return handle;
  };
  globalThis.clearTimeout = (handle) => {
    if (handle && typeof handle === 'object') handle.cleared = true;
  };
}

function pendingTimers() {
  return armedTimers.filter(timer => !timer.cleared && !timer.fired);
}

async function waitForArmedCount(count, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (armedTimers.length < count && Date.now() < deadline) {
    await new Promise(resolve => realSetTimeout(resolve, 10));
  }
}

let syncGrowattPlants = null;

if (supportsModuleMocks) {
  installSyncMocks();
  ({ syncGrowattPlants } = await import('../src/services/growattPlants.service.js'));
  before(() => installTimerSpy());
  after(() => {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  });
}

test('una pasada completada deja exactamente un timer de reprogramación pendiente', { skip: !supportsModuleMocks }, async () => {
  const result = await syncGrowattPlants();

  assert.equal(result.failed, 0);
  assert.equal(armedTimers.length, 1);
  assert.equal(armedTimers[0].delay, SYNC_INTERVAL_MS);
  assert.equal(pendingTimers().length, 1);
});

test('una segunda pasada completada no deja cadenas de timers duplicadas', { skip: !supportsModuleMocks }, async () => {
  const previous = pendingTimers()[0];

  const result = await syncGrowattPlants();

  assert.equal(result.skipped, undefined);
  assert.equal(previous.cleared, true, 'el timer pendiente anterior debe cancelarse al reprogramar');
  assert.equal(pendingTimers().length, 1, 'solo puede quedar una cadena de reprogramación pendiente');
});

test('varias invocaciones manuales completadas mantienen un único timer pendiente', { skip: !supportsModuleMocks }, async () => {
  await syncGrowattPlants();
  await syncGrowattPlants();

  assert.equal(pendingTimers().length, 1, 'cada pasada manual completada reutiliza la cadena pendiente');
});

test('el timer pendiente se limpia al dispararse y reprograma un único timer', { skip: !supportsModuleMocks }, async () => {
  const pending = pendingTimers();
  assert.equal(pending.length, 1);
  const fired = pending[0];
  fired.fired = true;
  const armedBefore = armedTimers.length;

  fired.fn();

  await waitForArmedCount(armedBefore + 1);
  assert.equal(pendingTimers().length, 1, 'tras dispararse debe quedar un único timer nuevo');
});
