import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

const plantId = '11111111-1111-4111-8111-111111111111';
let stored = null;
let upsertCall = null;

mock.module('../src/repositories/plantInstallationDetails.repository.js', {
  exports: {
    async getPlantInstallationDetails() { return stored; },
    async upsertPlantInstallationDetails(id, values) {
      upsertCall = { id, values };
      stored = values;
      return values;
    },
  },
});
mock.module('../src/repositories/plants.repository.js', {
  exports: { async getStoredPlantById(id) { return id === plantId ? { id } : null; } },
});

const {
  emptyInstallationDetails,
  getInstallationDetails,
  putInstallationDetails,
  validateInstallationDetails,
} = await import('../src/controllers/plantInstallationDetails.controller.js');

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function request({ role = 'client_user', inScope = true, body = {} } = {}) {
  return {
    params: { plantId }, body, profile: { role },
    scope: { plantIds: inScope ? new Set([plantId]) : new Set() },
  };
}

test('client_user puede leer configuración vacía', async () => {
  stored = null;
  const res = response();
  await getInstallationDetails(request(), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, emptyInstallationDetails());
});

test('client_user no puede modificar configuración', async () => {
  const res = response();
  await putInstallationDetails(request(), res);
  assert.equal(res.statusCode, 403);
});

test('planta fuera de alcance devuelve 404', async () => {
  const res = response();
  await getInstallationDetails(request({ inScope: false }), res);
  assert.equal(res.statusCode, 404);
});

test('valida rangos y no acepta plant_id en payload', () => {
  assert.equal(validateInstallationDetails({ panel_count: 0 }), null);
  assert.equal(validateInstallationDetails({ panel_count: 2.5 }), null);
  assert.equal(validateInstallationDetails({ panel_power_w: 0 }), null);
  assert.equal(validateInstallationDetails({ tilt_degrees: 91 }), null);
  assert.equal(validateInstallationDetails({ installed_at: '2026-02-30' }), null);
  assert.equal(validateInstallationDetails({ plant_id: plantId }), null);
  assert.deepEqual(validateInstallationDetails({
    installed_at: '2026-09-23', panel_count: 10, panel_power_w: 550,
    tilt_degrees: 20, panel_manufacturer: ' HYXi ',
  }), {
    installed_at: '2026-09-23', panel_manufacturer: 'HYXi', panel_model: null,
    orientation: null, panel_count: 10, panel_power_w: 550, tilt_degrees: 20,
  });
});

test('administrador realiza upsert 1:1 con plant_id de la ruta', async () => {
  upsertCall = null;
  const res = response();
  await putInstallationDetails(request({
    role: 'client_admin',
    body: { panel_count: 10, panel_power_w: 550, tilt_degrees: 0 },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(upsertCall.id, plantId);
  assert.equal(upsertCall.values.panel_count, 10);
  assert.equal(upsertCall.values.panel_power_w, 550);
  assert.equal(upsertCall.values.tilt_degrees, 0);
});
