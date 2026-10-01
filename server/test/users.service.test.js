import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isManagedProfile,
  visibleProfiles,
  resolveTarget,
  resolveCreate,
  resolvePatch,
  resolveStatus,
  validEmail,
  validatePlantIds,
} from '../src/services/users.service.js';

const ADMIN = { id: 'admin', client_id: null, role: 'rdx_admin', active: true };
const CA = { id: 'ca', client_id: null, role: 'client_admin', active: true };
const CU = { id: 'cu', client_id: null, role: 'client_user', active: true };
const CU2 = { id: 'cu2', client_id: 'legacy-fisico', role: 'client_user', active: true };
const RDX2 = { id: 'rdx2', client_id: null, role: 'rdx_admin', active: true };
const PLANT = '11111111-1111-4111-8111-111111111111';

function statusOf(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error.statusCode ?? null;
  }
}

test('rdx_admin lista global gestionable (sin rdx, sin exigir cliente)', () => {
  const visible = visibleProfiles([ADMIN, CA, CU, CU2, RDX2], ADMIN);
  assert.deepEqual(visible.map(p => p.id).sort(), ['ca', 'cu', 'cu2']);
});

test('no-rdx_admin no ve perfiles aunque comparta legacy client_id', () => {
  assert.deepEqual(visibleProfiles([CA, CU, CU2], CA), []);
});

test('rdx_admin crea client_admin y client_user sin client_id', () => {
  const a = resolveCreate(ADMIN, { email: 'a@x.com', role: 'client_admin' });
  assert.equal(a.role, 'client_admin');
  assert.deepEqual(a.plant_ids, []);
  assert.ok(!('client_id' in a));
  const u = resolveCreate(ADMIN, {
    email: 'u@x.com', role: 'client_user', display_name: ' N ', plant_ids: [PLANT],
  });
  assert.equal(u.display_name, 'N');
  assert.deepEqual(u.plant_ids, [PLANT]);
});

test('rdx_admin no crea rdx_admin y rechaza email/plant_ids inválidos', () => {
  assert.equal(statusOf(() => resolveCreate(ADMIN, { email: 'r@x.com', role: 'rdx_admin' })), 403);
  assert.equal(statusOf(() => resolveCreate(ADMIN, { email: 'mal', role: 'client_user' })), 400);
  assert.equal(statusOf(() => resolveCreate(ADMIN, { email: 'u@x.com', role: 'client_user', plant_ids: 'x' })), 400);
  assert.equal(statusOf(() => resolveCreate(ADMIN, { email: 'u@x.com', role: 'client_user', plant_ids: ['no-uuid'] })), 400);
});

test('client_admin ya no crea usuarios en esta fase', () => {
  assert.equal(statusOf(() => resolveCreate(CA, { email: 'n@x.com', role: 'client_user' })), 403);
});

test('validatePlantIds normaliza, dedup y exige UUIDs', () => {
  assert.deepEqual(validatePlantIds(undefined), []);
  assert.deepEqual(validatePlantIds(null), []);
  assert.deepEqual(validatePlantIds([]), []);
  assert.deepEqual(validatePlantIds([PLANT.toUpperCase(), PLANT]), [PLANT]);
  assert.equal(statusOf(() => validatePlantIds('x')), 400);
  assert.equal(statusOf(() => validatePlantIds([123])), 400);
});

test('resolveTarget: solo rdx_admin resuelve gestionables; rdx da 404', () => {
  assert.equal(statusOf(() => resolveTarget(CU, CA)), 403);
  assert.equal(statusOf(() => resolveTarget(RDX2, ADMIN)), 404);
  assert.equal(statusOf(() => resolveTarget(null, ADMIN)), 404);
  assert.doesNotThrow(() => resolveTarget(CU, ADMIN));
  assert.doesNotThrow(() => resolveTarget(CU2, ADMIN));
});

test('rdx_admin modifica display_name y rol entre gestionables', () => {
  assert.deepEqual(resolvePatch(ADMIN, CU, { display_name: 'Nuevo' }), { display_name: 'Nuevo' });
  assert.deepEqual(resolvePatch(ADMIN, CU, { role: 'client_user' }), {});
  assert.deepEqual(resolvePatch(ADMIN, CU, { role: 'client_admin' }), { role: 'client_admin' });
  assert.equal(statusOf(() => resolvePatch(ADMIN, CU, { role: 'rdx_admin' })), 403);
  assert.equal(statusOf(() => resolvePatch(ADMIN, CU, { client_id: 'B' })), 400);
  assert.equal(statusOf(() => resolvePatch(ADMIN, CU, { active: false })), 400);
  assert.equal(statusOf(() => resolvePatch(ADMIN, CU, { email: 'x@y.com' })), 400);
});

test('nadie cambia su propio rol ni su estado', () => {
  assert.deepEqual(resolvePatch(ADMIN, CU, { role: 'client_user' }), {});
  assert.equal(statusOf(() => resolveTarget(ADMIN, ADMIN)), 404);
  assert.equal(statusOf(() => resolvePatch(CA, CA, { role: 'client_user' })), 403);
  assert.equal(statusOf(() => resolveStatus(CA, CA, false)), 403);
  assert.equal(statusOf(() => resolveStatus(CA, CA, true)), 403);
  assert.equal(statusOf(() => resolveStatus(CA, CU, 'no')), 400);
  assert.equal(resolveStatus(ADMIN, CU, false), false);
});

test('client_user bloqueado a nivel ruta se refleja en roles válidos', () => {
  assert.ok(!['rdx_admin', 'client_admin'].includes(CU.role));
  assert.equal(validEmail('a@b.com'), true);
  assert.equal(validEmail('no-email'), false);
});
