import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

const supportsModuleMocks = typeof mock.module === 'function';

const fsFiles = new Map();
const providerState = { users: [{ c_user_name: 'user1' }], failUser: null };
const infoCalls = [];
let scheduledTimers = 0;
let syncGrowattPlants = null;

if (supportsModuleMocks) {
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
        async listUsers() { return providerState.users; }
        async listUserPlants(userName) {
          if (providerState.failUser === userName) {
            const error = new Error('Growatt user plants response failed');
            error.statusCode = 502;
            throw error;
          }
          return [{ plant_id: '1001', name: 'Planta', status: '1', peak_power: 5 }];
        }
        async plantDetails() { return {}; }
      },
    },
  });
  mock.module('../src/repositories/plants.repository.js', {
    exports: {
      async getOrCreateGrowattAccount() { return { id: 'acc1' }; },
      async upsertGrowattPlant() { return 'updated'; },
      async updateGrowattPlantDetail() {},
      async listGrowattPlantsByUser() { return []; },
      async updateGrowattPlantMetadata() {},
    },
  });
  ({ syncGrowattPlants } = await import('../src/services/growattPlants.service.js'));
}

const originalInfo = console.info;
const originalSetTimeout = globalThis.setTimeout;

function intercept() {
  infoCalls.length = 0;
  scheduledTimers = 0;
  console.info = (...args) => { infoCalls.push(args); };
  globalThis.setTimeout = (fn, ms, ...rest) => {
    scheduledTimers += 1;
    return originalSetTimeout(fn, ms, ...rest);
  };
}

function restore() {
  console.info = originalInfo;
  globalThis.setTimeout = originalSetTimeout;
}

function progress() {
  return JSON.parse(fsFiles.get(String(fsFiles.keys().next().value)) ?? '{}');
}

test('pasada exitosa emite exactamente 1 console.info sin cambiar progress ni schedule', { skip: !supportsModuleMocks }, async t => {
  t.after(restore);
  fsFiles.clear();
  providerState.users = [{ c_user_name: 'user1' }];
  providerState.failUser = null;
  intercept();
  const result = await syncGrowattPlants();
  assert.equal(infoCalls.length, 1);
  assert.equal(infoCalls[0][0], 'Growatt automatic plants sync pass');
  assert.deepEqual(infoCalls[0][1], {
    processed_user: 'user1', remaining_users: 0, failed: 0, errors: [],
  });
  assert.deepEqual(progress(), { user1: true });
  assert.equal(scheduledTimers, 1);
  assert.equal(result.updated, 1);
});

test('pasada fallida emite exactamente 1 console.info con el error y sin secretos', { skip: !supportsModuleMocks }, async t => {
  t.after(restore);
  fsFiles.clear();
  providerState.users = [{ c_user_name: 'userSlow' }];
  providerState.failUser = 'userSlow';
  intercept();
  const result = await syncGrowattPlants();
  assert.equal(infoCalls.length, 1);
  assert.equal(infoCalls[0][0], 'Growatt automatic plants sync pass');
  assert.equal(infoCalls[0][1].processed_user, 'userSlow');
  assert.equal(infoCalls[0][1].failed, 1);
  assert.equal(infoCalls[0][1].errors.length, 1);
  assert.match(infoCalls[0][1].errors[0], /userSlow/);
  assert.doesNotMatch(JSON.stringify(infoCalls), /token|api[_-]?key|secret|authorization|bearer|password/i);
  assert.deepEqual(progress(), {});
  assert.equal(scheduledTimers, 1);
  assert.equal(result.failed, 1);
});

test('fin de ronda emite exactamente 1 console.info y resetea progress como antes', { skip: !supportsModuleMocks }, async t => {
  t.after(restore);
  fsFiles.clear();
  providerState.users = [{ c_user_name: 'user1' }];
  providerState.failUser = null;
  intercept();
  await syncGrowattPlants();
  assert.equal(infoCalls.length, 1);
  await syncGrowattPlants();
  assert.equal(infoCalls.length, 2);
  assert.equal(infoCalls[1][0], 'Growatt automatic plants sync pass');
  assert.deepEqual(infoCalls[1][1], {
    processed_user: null, remaining_users: 0, failed: 0, errors: [],
  });
  assert.deepEqual(progress(), {});
  assert.equal(scheduledTimers, 2);
});
