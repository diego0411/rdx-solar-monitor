import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

const plantId = '11111111-1111-4111-8111-111111111111';
const otherPlantId = '22222222-2222-4222-8222-222222222222';
const visitId = '33333333-3333-4333-8333-333333333333';
const adminId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

let visits = [];
let listArgs = null;
let insertCall = null;
let updateCall = null;

mock.module('../src/repositories/maintenanceVisits.repository.js', {
  namedExports: {
    async listMaintenanceVisits(args) {
      listArgs = args;
      return visits.filter(v => !args.plantId || v.plant_id === args.plantId);
    },
    async getMaintenanceVisitById(id) {
      return visits.find(v => v.id === id) ?? null;
    },
    async insertMaintenanceVisit(values) {
      insertCall = values;
      const row = { id: visitId, status: 'scheduled', ...values };
      visits.push(row);
      return row;
    },
    async updateMaintenanceVisit(id, values) {
      updateCall = { id, values };
      const row = visits.find(v => v.id === id);
      Object.assign(row, values);
      return row;
    },
  },
});
mock.module('../src/repositories/plants.repository.js', {
  namedExports: {
    async getStoredPlantById(id) {
      return id === plantId ? { id } : null;
    },
  },
});

const {
  getMaintenance,
  listMaintenance,
  patchMaintenance,
  postMaintenance,
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
  role = 'client_user', plantIds = [plantId], profileId = adminId,
  params = {}, query = {}, body = {},
} = {}) {
  return {
    params, query, body,
    profile: { id: profileId, role },
    scope: { plantIds: role === 'rdx_admin' ? null : new Set(plantIds) },
  };
}

function seed() {
  visits = [
    { id: visitId, plant_id: plantId, title: 'Preventivo Q3', status: 'scheduled' },
    { id: '44444444-4444-4444-8444-444444444444', plant_id: otherPlantId, title: 'Otra planta', status: 'scheduled' },
  ];
  listArgs = null; insertCall = null; updateCall = null;
}

test('1. GET lista autenticada solo devuelve visitas en scope', async () => {
  seed();
  const res = response();
  await listMaintenance(request(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(listArgs.plantIds instanceof Set, true);
  assert.deepEqual([...listArgs.plantIds], [plantId]);
});

test('2. filtros básicos plantId/status/fechas llegan al repositorio', async () => {
  seed();
  const res = response();
  await listMaintenance(request({
    query: {
      plantId, status: 'scheduled',
      dateFrom: '2026-01-01T00:00:00.000Z', dateTo: '2026-12-31T00:00:00.000Z',
    },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual([...listArgs.plantIds], [plantId]);
  assert.equal(listArgs.status, 'scheduled');
  assert.equal(listArgs.dateFrom, '2026-01-01T00:00:00.000Z');
  assert.equal(listArgs.dateTo, '2026-12-31T00:00:00.000Z');
});

test('3. GET detalle devuelve la visita en scope', async () => {
  seed();
  const res = response();
  await getMaintenance(request({ params: { id: visitId } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.id, visitId);
});

test('4. POST rdx_admin válido crea con created_by propio', async () => {
  seed();
  const res = response();
  await postMaintenance(request({
    role: 'rdx_admin',
    body: { plant_id: plantId, title: ' Revisión anual ', priority: 'high', service_amount: 1500 },
  }), res);
  assert.equal(res.statusCode, 201);
  assert.equal(insertCall.title, 'Revisión anual');
  assert.equal(insertCall.created_by, adminId);
  assert.equal(insertCall.priority, 'high');
});

test('5. POST client_admin válido', async () => {
  seed();
  const res = response();
  await postMaintenance(request({
    role: 'client_admin',
    body: { plant_id: plantId, title: 'Limpieza paneles' },
  }), res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.title, 'Limpieza paneles');
});

test('6. POST client_user → 403', async () => {
  seed();
  const res = response();
  await postMaintenance(request({ body: { plant_id: plantId, title: 'X' } }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(insertCall, null);
});

test('7. POST plant_id fuera de scope o inexistente → 404', async () => {
  seed();
  const outScope = response();
  await postMaintenance(request({
    role: 'client_admin', body: { plant_id: otherPlantId, title: 'X' },
  }), outScope);
  assert.equal(outScope.statusCode, 404);
  const unknown = response();
  await postMaintenance(request({
    role: 'rdx_admin', body: { plant_id: '99999999-9999-4999-8999-999999999999', title: 'X' },
  }), unknown);
  assert.equal(unknown.statusCode, 404);
  assert.equal(insertCall, null);
});

test('8. created_by del body se ignora y usa identidad autenticada', async () => {
  seed();
  const res = response();
  await postMaintenance(request({
    role: 'rdx_admin',
    body: { plant_id: plantId, title: 'Y', created_by: '10000000-1000-4000-8000-100000000000' },
  }), res);
  assert.equal(res.statusCode, 201);
  assert.equal(insertCall.created_by, adminId);
});

test('9. POST con status completed se rechaza', async () => {
  seed();
  const res = response();
  await postMaintenance(request({
    role: 'rdx_admin',
    body: { plant_id: plantId, title: 'Z', status: 'completed' },
  }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(insertCall, null);
});

test('10. PATCH permitido actualiza campos editables', async () => {
  seed();
  const res = response();
  await patchMaintenance(request({
    role: 'client_admin',
    params: { id: visitId },
    body: { title: 'Preventivo Q4', service_amount: 2000 },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(updateCall.values.title, 'Preventivo Q4');
  assert.equal(updateCall.values.service_amount, 2000);
});

test('11. PATCH client_user → 403', async () => {
  seed();
  const res = response();
  await patchMaintenance(request({
    params: { id: visitId }, body: { title: 'Hack' },
  }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(updateCall, null);
});

test('12. PATCH ignora campos protegidos sin modificarlos', async () => {
  seed();
  const res = response();
  await patchMaintenance(request({
    role: 'rdx_admin',
    params: { id: visitId },
    body: {
      title: 'Nuevo título', plant_id: otherPlantId, status: 'completed',
      completed_at: '2026-09-26T00:00:00.000Z',
      created_by: adminId, created_at: '2020-01-01T00:00:00.000Z', id: otherPlantId,
    },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(updateCall.values.title, 'Nuevo título');
  assert.equal('plant_id' in updateCall.values, false);
  assert.equal('status' in updateCall.values, false);
  assert.equal('completed_at' in updateCall.values, false);
  assert.equal('created_by' in updateCall.values, false);
  const row = visits.find(v => v.id === visitId);
  assert.equal(row.plant_id, plantId);
  assert.equal(row.status, 'scheduled');
});

test('13. GET inexistente o fuera de scope → 404', async () => {
  seed();
  const missing = response();
  await getMaintenance(request({ params: { id: '99999999-9999-4999-8999-999999999999' } }), missing);
  assert.equal(missing.statusCode, 404);
  const outScope = response();
  await getMaintenance(request({
    params: { id: visits[1].id }, plantIds: [plantId],
  }), outScope);
  assert.equal(outScope.statusCode, 404);
});

test('service_amount negativo se rechaza', async () => {
  seed();
  const res = response();
  await postMaintenance(request({
    role: 'rdx_admin',
    body: { plant_id: plantId, title: 'W', service_amount: -5 },
  }), res);
  assert.equal(res.statusCode, 400);
});
