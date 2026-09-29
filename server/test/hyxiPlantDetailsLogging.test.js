import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

const supportsModuleMocks = typeof mock.module === 'function';

const errorCalls = [];
const infoCalls = [];
const updatedPlants = [];
const mode = { current: 'fail429' };

if (supportsModuleMocks) {
  mock.module('../src/providers/hyxi/HyxiProvider.js', {
    exports: {
      HyxiProvider: class {
        async getPlant(externalPlantId) {
          if (mode.current === 'ok') {
            return { data: { plantType: 1, capacity: 5000, timeZone: 'America/La_Paz' } };
          }
          if (externalPlantId === 'ext-fail') {
            if (mode.current === 'weird') throw 'string failure';
            const error = new Error('Unsuccessful HYXi response');
            error.httpStatus = 429;
            error.providerCode = '102';
            error.providerMsg = 'FREQUENTLY_ACCESS';
            throw error;
          }
          return { data: { plantType: 1, capacity: 5000, timeZone: 'America/La_Paz' } };
        }
      },
    },
  });
  mock.module('../src/repositories/plants.repository.js', {
    exports: {
      async listActiveHyxiPlants() {
        return [
          { id: 'p-ok', external_plant_id: 'ext-ok' },
          { id: 'p-fail', external_plant_id: 'ext-fail' },
        ];
      },
      async updatePlantDetail(id) { updatedPlants.push(id); },
    },
  });
}

const originalError = console.error;
const originalInfo = console.info;
function intercept() {
  errorCalls.length = 0;
  infoCalls.length = 0;
  updatedPlants.length = 0;
  console.error = (...args) => { errorCalls.push(args); };
  console.info = (...args) => { infoCalls.push(args); };
}
function restore() {
  console.error = originalError;
  console.info = originalInfo;
}

let syncHyxiPlantDetails = null;
if (supportsModuleMocks) {
  ({ syncHyxiPlantDetails } = await import('../src/services/hyxiPlantDetails.service.js'));
}

test('1. fallo de una planta: cuenta, continúa y loguea identificadores sanitizados', { skip: !supportsModuleMocks }, async t => {
  t.after(restore);
  intercept();
  const result = await syncHyxiPlantDetails();
  assert.deepEqual(result, { provider: 'hyxi', fetched: 2, updated: 1, failed: 1 });
  assert.deepEqual(updatedPlants, ['p-ok']);
  assert.equal(errorCalls.length, 1);
  assert.equal(errorCalls[0][0], 'HYXi plant details sync failed');
  assert.equal(errorCalls[0][1].plant_id, 'p-fail');
  assert.equal(errorCalls[0][1].external_plant_id, 'ext-fail');
  assert.equal(errorCalls[0][1].http_status, 429);
  assert.equal(errorCalls[0][1].provider_code, '102');
  assert.match(errorCalls[0][1].message, /Unsuccessful/);
  assert.equal(infoCalls.length, 1);
  assert.equal(infoCalls[0][0], 'HYXi plant details sync pass');
  assert.deepEqual(infoCalls[0][1], { fetched: 2, updated: 1, failed: 1 });
});

test('2. error inesperado no rompe el sync ni el logger', { skip: !supportsModuleMocks }, async t => {
  t.after(restore);
  mode.current = 'weird';
  intercept();
  const result = await syncHyxiPlantDetails();
  assert.deepEqual(result, { provider: 'hyxi', fetched: 2, updated: 1, failed: 1 });
  assert.equal(errorCalls.length, 1);
  assert.ok(errorCalls[0][1].message);
  mode.current = 'fail429';
});

test('3. ningún secreto ni token en los logs', { skip: !supportsModuleMocks }, async t => {
  t.after(restore);
  intercept();
  await syncHyxiPlantDetails();
  const dumped = JSON.stringify([...errorCalls, ...infoCalls]);
  assert.doesNotMatch(dumped, /bearer|authorization|access_token|api[_-]?key|secret|password|credential|headers/i);
});

test('4-5. éxito conserva comportamiento y contadores', { skip: !supportsModuleMocks }, async t => {
  t.after(restore);
  mode.current = 'ok';
  intercept();
  const result = await syncHyxiPlantDetails();
  assert.deepEqual(result, { provider: 'hyxi', fetched: 2, updated: 2, failed: 0 });
  assert.deepEqual(updatedPlants, ['p-ok', 'p-fail']);
  assert.equal(errorCalls.length, 0);
  assert.equal(infoCalls.length, 1);
  assert.deepEqual(infoCalls[0][1], { fetched: 2, updated: 2, failed: 0 });
  mode.current = 'fail429';
});
