import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

const supportsModuleMocks = typeof mock.module === 'function';

const captured = { plantWrites: [], metadataWrites: [] };
const fsFiles = new Map();

const providerState = { users: [{ c_user_name: 'user1' }], failUser: null };

function installPlantSyncMocks() {
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
        async listUserPlants(userName) {
          if (providerState.failUser === userName) {
            const error = new Error('Growatt user plants response failed');
            error.statusCode = 502;
            throw error;
          }
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
      async listGrowattPlantsByUser(userName) {
        return userName === 'userSlow'
          ? [{ external_plant_id: '2002', metadata: { c_user_name: 'userSlow', status: '2' } }]
          : [];
      },
      async updateGrowattPlantMetadata(externalPlantId, metadata) {
        captured.metadataWrites.push({ externalPlantId, metadata });
      },
    },
  });
}

let syncGrowattPlants = null;

if (supportsModuleMocks) {
  installPlantSyncMocks();
  ({ syncGrowattPlants } = await import('../src/services/growattPlants.service.js'));
}

test('syncGrowattPlants escribe plant.status offline cuando user_plant_list devuelve status=4', { skip: !supportsModuleMocks }, async () => {
  const result = await syncGrowattPlants();

  assert.equal(result.processed_users, 1);
  assert.equal(result.remaining_users, 0);
  assert.equal(result.fetched_plants, 1);
  assert.equal(result.updated, 1);
  assert.equal(result.errors.length, 0);

  assert.equal(captured.plantWrites.length, 1);
  assert.equal(captured.plantWrites[0].external_plant_id, '1001');
  assert.equal(captured.plantWrites[0].name, 'Planta Granja');
  assert.equal(captured.plantWrites[0].status, 'offline');
  assert.equal(captured.plantWrites[0].metadata.provider_plant_status, '4');
});

test('fallo transitorio de user_plant_list conserva el estado y registra error sanitizado en metadata', { skip: !supportsModuleMocks }, async () => {
  providerState.users = [{ c_user_name: 'user1' }, { c_user_name: 'userSlow' }];
  providerState.failUser = 'userSlow';

  const result = await syncGrowattPlants();

  assert.equal(result.processed_user, 'userSlow');
  assert.equal(result.failed, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Growatt: userSlow: Growatt user plants response failed/);

  const progress = JSON.parse(fsFiles.get(String(fsFiles.keys().next().value)) ?? '{}');
  assert.equal(progress.user1, true);
  assert.equal(progress.userSlow, undefined);

  assert.deepEqual(captured.metadataWrites, [{
    externalPlantId: '2002',
    metadata: {
      c_user_name: 'userSlow',
      status: '2',
      growatt_sync_error: 'Growatt: userSlow: Growatt user plants response failed',
    },
  }]);
});