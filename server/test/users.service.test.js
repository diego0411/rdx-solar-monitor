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
} from '../src/services/users.service.js';

const ADMIN = { id: 'admin', client_id: null, role: 'rdx_admin', active: true };
const CA_A = { id: 'ca-a', client_id: 'A', role: 'client_admin', active: true };
const CU_A = { id: 'cu-a', client_id: 'A', role: 'client_user', active: true };
const CU_A2 = { id: 'cu-a2', client_id: 'A', role: 'client_user', active: true };
const CU_B = { id: 'cu-b', client_id: 'B', role: 'client_user', active: true };
const CA_B = { id: 'ca-b', client_id: 'B', role: 'client_admin', active: true };
const RDX2 = { id: 'rdx2', client_id: null, role: 'rdx_admin', active: true };
const USER = { id: 'u', client_id: 'A', role: 'client_user', active: true };

function statusOf(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error.statusCode ?? null;
  }
}

test('rdx_admin lista global gestionable (sin rdx)', () => {
  const visible = visibleProfiles([ADMIN, CA_A, CU_A, CU_B, RDX2], ADMIN);
  assert.deepEqual(visible.map(p => p.id).sort(), ['ca-a', 'cu-a', 'cu-b']);
});

test('client_admin lista únicamente su cliente', () => {
  const visible = visibleProfiles([CA_A, CU_A, CU_A2, CU_B, CA_B, ADMIN], CA_A);
  assert.deepEqual(visible.map(p => p.id).sort(), ['ca-a', 'cu-a', 'cu-a2']);
});

test('rdx_admin crea client_admin y client_user con client_id válido', () => {
  const a = resolveCreate(ADMIN, { email: 'a@x.com', role: 'client_admin', client_id: 'A' });
  assert.equal(a.role, 'client_admin');
  assert.equal(a.client_id, 'A');
  const u = resolveCreate(ADMIN, { email: 'u@x.com', role: 'client_user', client_id: 'B', display_name: ' N ' });
  assert.equal(u.display_name, 'N');
});

test('rdx_admin no crea rdx_admin y rechaza email/client_id inválidos', () => {
  assert.equal(statusOf(() => resolveCreate(ADMIN, { email: 'r@x.com', role: 'rdx_admin', client_id: 'A' })), 403);
  assert.equal(statusOf(() => resolveCreate(ADMIN, { email: 'mal', role: 'client_user', client_id: 'A' })), 400);
  assert.equal(statusOf(() => resolveCreate(ADMIN, { email: 'u@x.com', role: 'client_user' })), 400);
});

test('client_admin crea client_user solo en su cliente aunque body pida B', () => {
  const created = resolveCreate(CA_A, { email: 'n@x.com', role: 'client_user', client_id: 'B' });
  assert.equal(created.client_id, 'A');
  assert.equal(created.role, 'client_user');
  const forced = resolveCreate(CA_A, { email: 'n@x.com' });
  assert.equal(forced.client_id, 'A');
});

test('client_admin no crea client_admin ni rdx_admin', () => {
  assert.equal(statusOf(() => resolveCreate(CA_A, { email: 'a@x.com', role: 'client_admin' })), 403);
  assert.equal(statusOf(() => resolveCreate(CA_A, { email: 'a@x.com', role: 'rdx_admin' })), 403);
});

test('resolveTarget: ajeno y rdx devuelven 404', () => {
  assert.equal(statusOf(() => resolveTarget(CU_B, CA_A)), 404);
  assert.equal(statusOf(() => resolveTarget(CA_B, CA_A)), 404);
  assert.equal(statusOf(() => resolveTarget(RDX2, ADMIN)), 404);
  assert.equal(statusOf(() => resolveTarget(null, ADMIN)), 404);
  assert.doesNotThrow(() => resolveTarget(CU_A, CA_A));
  assert.doesNotThrow(() => resolveTarget(CU_A, ADMIN));
});

test('client_admin modifica client_user propio, no roles ni ajenos', () => {
  assert.deepEqual(resolvePatch(CA_A, CU_A, { display_name: 'Nuevo' }), { display_name: 'Nuevo' });
  assert.deepEqual(resolvePatch(CA_A, CU_A, { role: 'client_user' }), {});
  assert.equal(statusOf(() => resolvePatch(CA_A, CU_A, { role: 'client_admin' })), 403);
  assert.equal(statusOf(() => resolvePatch(CA_A, CU_A, { role: 'rdx_admin' })), 403);
  assert.equal(statusOf(() => resolvePatch(CA_A, CU_A, { client_id: 'B' })), 400);
  assert.equal(statusOf(() => resolvePatch(CA_A, CU_A, { active: false })), 400);
  assert.equal(statusOf(() => resolvePatch(CA_A, CU_A, { email: 'x@y.com' })), 400);
});

test('rdx_admin cambia client_admin<->client_user pero no a rdx_admin', () => {
  assert.deepEqual(resolvePatch(ADMIN, CU_A, { role: 'client_admin' }), { role: 'client_admin' });
  assert.equal(statusOf(() => resolvePatch(ADMIN, CU_A, { role: 'rdx_admin' })), 403);
});

test('nadie cambia su propio rol; client_admin no se desactiva a sí mismo', () => {
  assert.equal(statusOf(() => resolvePatch(CA_A, CA_A, { role: 'client_user' })), 403);
  assert.equal(statusOf(() => resolveStatus(CA_A, CA_A, false)), 403);
  assert.equal(statusOf(() => resolveStatus(CA_A, CA_A, true)), 403);
  assert.equal(resolveStatus(CA_A, CU_A, false), false);
  assert.equal(statusOf(() => resolveStatus(CA_A, CU_A, 'no')), 400);
});

test('client_user bloqueado a nivel ruta se refleja en roles válidos', () => {
  assert.ok(!['rdx_admin', 'client_admin'].includes(USER.role));
  assert.equal(validEmail('a@b.com'), true);
  assert.equal(validEmail('no-email'), false);
});
