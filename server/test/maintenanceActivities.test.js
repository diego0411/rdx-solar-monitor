import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

const plantA = '11111111-1111-4111-8111-111111111111';
const plantB = '22222222-2222-4222-8222-222222222222';
const visitA = '33333333-3333-4333-8333-333333333333';
const visitB = '44444444-4444-4444-8444-444444444444';
const deviceA = '55555555-5555-4555-8555-555555555555';
const deviceB = '66666666-6666-4666-8666-666666666666';
const unknownDevice = '77777777-7777-4777-8777-777777777777';

const visits = {
  [visitA]: { id: visitA, plant_id: plantA, title: 'Visita A' },
  [visitB]: { id: visitB, plant_id: plantB, title: 'Visita B' },
};
const devices = {
  [deviceA]: { id: deviceA, plant_id: plantA },
  [deviceB]: { id: deviceB, plant_id: plantB },
};
let activities = [];
let insertCall = null;
let updateCall = null;
let deleteCall = null;

mock.module('../src/repositories/maintenanceVisits.repository.js', {
  namedExports: {
    async getMaintenanceVisitById(id) { return visits[id] ?? null; },
    async listMaintenanceVisits() { return []; },
    async insertMaintenanceVisit(values) { return values; },
    async updateMaintenanceVisit(id, values) { return { id, ...values }; },
  },
});
mock.module('../src/repositories/maintenanceActivities.repository.js', {
  namedExports: {
    async listActivitiesByVisitId(visitId) {
      return activities.filter(a => a.maintenance_visit_id === visitId);
    },
    async getMaintenanceActivityById(id) {
      return activities.find(a => a.id === id) ?? null;
    },
    async insertMaintenanceActivity(values) {
      insertCall = values;
      const row = { id: '88888888-8888-4888-8888-888888888888', created_at: '2026-09-26T00:00:00.000Z', ...values };
      activities.push(row);
      return row;
    },
    async updateMaintenanceActivity(id, values) {
      updateCall = { id, values };
      const row = activities.find(a => a.id === id);
      Object.assign(row, values);
      return row;
    },
    async deleteMaintenanceActivity(id) { deleteCall = id; },
    async getDevicePlant(deviceId) { return devices[deviceId] ?? null; },
  },
});

const {
  deleteActivity,
  getMaintenance,
  patchActivity,
  postActivity,
} = await import('../src/controllers/maintenance.controller.js');

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function request({
  role = 'client_admin', plantIds = [plantA],
  visitId = visitA, activityId = null, body = {},
} = {}) {
  return {
    params: { id: visitId, ...(activityId ? { activityId } : {}) },
    body,
    profile: { id: 'admin', role },
    scope: { plantIds: role === 'rdx_admin' ? null : new Set(plantIds) },
  };
}

function seed() {
  activities = [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', maintenance_visit_id: visitA,
      device_id: null, title: 'Primera', created_at: '2026-09-25T10:00:00.000Z',
    },
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', maintenance_visit_id: visitA,
      device_id: deviceA, title: 'Segunda', created_at: '2026-09-25T11:00:00.000Z',
    },
    {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', maintenance_visit_id: visitB,
      device_id: null, title: 'Otra visita', created_at: '2026-09-25T12:00:00.000Z',
    },
  ];
  insertCall = null; updateCall = null; deleteCall = null;
}

const validBody = { activity_type: 'preventive', title: 'Limpieza' };

test('1. crear actividad de planta completa (device_id null)', async () => {
  seed();
  const res = response();
  await postActivity(request({ body: validBody }), res);
  assert.equal(res.statusCode, 201);
  assert.equal(insertCall.device_id, null);
  assert.equal(insertCall.maintenance_visit_id, visitA);
});

test('2. crear actividad con dispositivo de la misma planta', async () => {
  seed();
  const res = response();
  await postActivity(request({ body: { ...validBody, device_id: deviceA } }), res);
  assert.equal(res.statusCode, 201);
  assert.equal(insertCall.device_id, deviceA);
});

test('3. dispositivo de otra planta → 404', async () => {
  seed();
  const res = response();
  await postActivity(request({
    role: 'rdx_admin', body: { ...validBody, device_id: deviceB },
  }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(insertCall, null);
});

test('4. device inexistente → 404', async () => {
  seed();
  const res = response();
  await postActivity(request({ body: { ...validBody, device_id: unknownDevice } }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(insertCall, null);
});

test('5. activity_type inválido → 400', async () => {
  seed();
  const res = response();
  await postActivity(request({ body: { activity_type: 'repair', title: 'X' } }), res);
  assert.equal(res.statusCode, 400);
});

test('6. client_user POST → 403', async () => {
  seed();
  const res = response();
  await postActivity(request({ role: 'client_user', body: validBody }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(insertCall, null);
});

test('7. PATCH válido actualiza título', async () => {
  seed();
  const res = response();
  await patchActivity(request({
    activityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    body: { title: 'Actualizada' },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(updateCall.values.title, 'Actualizada');
});

test('8. PATCH cambiando a dispositivo válido', async () => {
  seed();
  const res = response();
  await patchActivity(request({
    activityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    body: { device_id: deviceA },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(updateCall.values.device_id, deviceA);
});

test('9. PATCH device_id=null cambia a planta completa', async () => {
  seed();
  const res = response();
  await patchActivity(request({
    activityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    body: { device_id: null },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(updateCall.values.device_id, null);
});

test('10. PATCH con dispositivo de otra planta → 404', async () => {
  seed();
  const res = response();
  await patchActivity(request({
    role: 'rdx_admin',
    activityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    body: { device_id: deviceB },
  }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(updateCall, null);
});

test('11. actividad de otra visita → 404', async () => {
  seed();
  const res = response();
  await patchActivity(request({
    activityId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    body: { title: 'Hack' },
  }), res);
  assert.equal(res.statusCode, 404);
  const del = response();
  await deleteActivity(request({
    activityId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  }), del);
  assert.equal(del.statusCode, 404);
  assert.equal(deleteCall, null);
});

test('12. DELETE válido', async () => {
  seed();
  const res = response();
  await deleteActivity(request({
    activityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(deleteCall, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
});

test('13. DELETE client_user → 403', async () => {
  seed();
  const res = response();
  await deleteActivity(request({
    role: 'client_user',
    activityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(deleteCall, null);
});

test('14. GET detalle devuelve activities ordenadas por created_at ASC', async () => {
  seed();
  const res = response();
  await getMaintenance(request({ role: 'client_user' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.activities.length, 2);
  assert.deepEqual(res.body.activities.map(a => a.title), ['Primera', 'Segunda']);
});
