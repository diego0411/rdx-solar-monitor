import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

const plantA = '11111111-1111-4111-8111-111111111111';
const visitScheduled = '33333333-3333-4333-8333-333333333333';
const visitInProgress = '44444444-4444-4444-8444-444444444444';
const visitCompleted = '55555555-5555-4555-8555-555555555555';
const visitCancelled = '66666666-6666-4666-8666-666666666666';
const otherVisit = '22222222-2222-4222-8222-222222222222';

const visits = {
  [visitScheduled]: { id: visitScheduled, plant_id: plantA, status: 'scheduled', completed_at: null },
  [visitInProgress]: { id: visitInProgress, plant_id: plantA, status: 'in_progress', completed_at: null },
  [visitCompleted]: { id: visitCompleted, plant_id: plantA, status: 'completed', completed_at: '2026-09-25T10:00:00.000Z' },
  [visitCancelled]: { id: visitCancelled, plant_id: plantA, status: 'cancelled', completed_at: null },
};
let activitiesByVisit = {};
let updateCall = null;

mock.module('../src/repositories/maintenanceVisits.repository.js', {
  namedExports: {
    async getMaintenanceVisitById(id) { return visits[id] ?? null; },
    async listMaintenanceVisits() { return []; },
    async insertMaintenanceVisit(values) { return values; },
    async updateMaintenanceVisit(id, values) {
      updateCall = { id, values };
      return { ...visits[id], ...values };
    },
  },
});
mock.module('../src/repositories/maintenanceActivities.repository.js', {
  namedExports: {
    async listActivitiesByVisitId(visitId) { return activitiesByVisit[visitId] ?? []; },
    async getMaintenanceActivityById() { return null; },
    async insertMaintenanceActivity(values) { return values; },
    async updateMaintenanceActivity(id, values) { return { id, ...values }; },
    async deleteMaintenanceActivity() {},
    async getDevicePlant() { return null; },
  },
});

const { patchMaintenanceStatus } = await import('../src/controllers/maintenance.controller.js');

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function request({ role = 'client_admin', plantIds = [plantA], visitId, body }) {
  return {
    params: { id: visitId },
    body,
    profile: { id: 'admin', role },
    scope: { plantIds: role === 'rdx_admin' ? null : new Set(plantIds) },
  };
}

function seed(withActivities = true) {
  activitiesByVisit = withActivities
    ? { [visitInProgress]: [{ id: 'a', title: 'Act' }], [visitScheduled]: [{ id: 'b', title: 'Act' }] }
    : {};
  updateCall = null;
}

test('1. scheduled → in_progress ✓', async () => {
  seed();
  const res = response();
  await patchMaintenanceStatus(request({ visitId: visitScheduled, body: { status: 'in_progress' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(updateCall.values.status, 'in_progress');
  assert.equal(updateCall.values.completed_at, null);
});

test('2. scheduled → cancelled ✓', async () => {
  seed();
  const res = response();
  await patchMaintenanceStatus(request({ visitId: visitScheduled, body: { status: 'cancelled' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(updateCall.values.status, 'cancelled');
  assert.equal(updateCall.values.completed_at, null);
});

test('3. scheduled → completed → 400', async () => {
  seed();
  const res = response();
  await patchMaintenanceStatus(request({ visitId: visitScheduled, body: { status: 'completed' } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(updateCall, null);
});

test('4. in_progress → completed ✓', async () => {
  seed();
  const res = response();
  await patchMaintenanceStatus(request({ visitId: visitInProgress, body: { status: 'completed' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(updateCall.values.status, 'completed');
});

test('5. completed establece completed_at automáticamente', async () => {
  seed();
  const before = Date.now();
  const res = response();
  await patchMaintenanceStatus(request({ visitId: visitInProgress, body: { status: 'completed' } }), res);
  assert.equal(res.statusCode, 200);
  const stamped = Date.parse(updateCall.values.completed_at);
  assert.ok(Number.isFinite(stamped) && Math.abs(Date.now() - stamped) < Math.max(60000, Date.now() - before + 1000));
});

test('6. in_progress → cancelled ✓', async () => {
  seed();
  const res = response();
  await patchMaintenanceStatus(request({ visitId: visitInProgress, body: { status: 'cancelled' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(updateCall.values.status, 'cancelled');
});

test('7. completed → cualquier estado → 400', async () => {
  seed();
  for (const status of ['in_progress', 'cancelled', 'completed']) {
    const res = response();
    await patchMaintenanceStatus(request({ visitId: visitCompleted, body: { status } }), res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(updateCall, null);
});

test('8. cancelled → cualquier estado → 400', async () => {
  seed();
  for (const status of ['in_progress', 'completed', 'cancelled']) {
    const res = response();
    await patchMaintenanceStatus(request({ visitId: visitCancelled, body: { status } }), res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(updateCall, null);
});

test('9. status=scheduled mediante endpoint → 400', async () => {
  seed();
  const res = response();
  await patchMaintenanceStatus(request({ visitId: visitInProgress, body: { status: 'scheduled' } }), res);
  assert.equal(res.statusCode, 400);
});

test('10. completar sin actividades → 400', async () => {
  seed(false);
  const res = response();
  await patchMaintenanceStatus(request({ visitId: visitInProgress, body: { status: 'completed' } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(updateCall, null);
});

test('11. completar con >=1 actividad ✓', async () => {
  seed();
  const res = response();
  await patchMaintenanceStatus(request({ visitId: visitInProgress, body: { status: 'completed' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'completed');
});

test('12. client_user → 403', async () => {
  seed();
  const res = response();
  await patchMaintenanceStatus(request({
    role: 'client_user', visitId: visitScheduled, body: { status: 'in_progress' },
  }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(updateCall, null);
});

test('13. visita inexistente/fuera de scope → 404', async () => {
  seed();
  const missing = response();
  await patchMaintenanceStatus(request({
    visitId: '99999999-9999-4999-8999-999999999999', body: { status: 'cancelled' },
  }), missing);
  assert.equal(missing.statusCode, 404);
  const outScope = response();
  await patchMaintenanceStatus(request({
    visitId: visitScheduled, body: { status: 'cancelled' }, plantIds: [],
  }), outScope);
  assert.equal(outScope.statusCode, 404);
  assert.equal(updateCall, null);
});

test('14. completed_at del cliente se ignora; manda el servidor', async () => {
  seed();
  const res = response();
  await patchMaintenanceStatus(request({
    visitId: visitInProgress,
    body: { status: 'completed', completed_at: '2020-01-01T00:00:00.000Z' },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.notEqual(updateCall.values.completed_at, '2020-01-01T00:00:00.000Z');
  assert.ok(Date.parse(updateCall.values.completed_at) > Date.parse('2025-01-01T00:00:00.000Z'));
});
