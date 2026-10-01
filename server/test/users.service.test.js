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
  validateModulePermissions,
} from '../src/services/users.service.js';

const ADMIN = { id: 'admin', client_id: null, role: 'rdx_admin', active: true };
const CA = { id: 'ca', client_id: null, role: 'client_admin', active: true };
const CU = { id: 'cu', client_id: null, role: 'client_user', active: true };
const CU2 = { id: 'cu2', client_id: 'legacy-fisico', role: 'client_user', active: true };
const RDX2 = { id: 'rdx2', client_id: null, role: 'rdx_admin', active: true };

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

test('rdx_admin crea client_user con permisos y client_admin sin ellos', () => {
  const u = resolveCreate(ADMIN, {
    email: 'u@x.com', role: 'client_user', display_name: ' N ',
    module_permissions: ['dashboard', 'plants', 'plants'],
  });
  assert.equal(u.role, 'client_user');
  assert.deepEqual(u.module_permissions, ['dashboard', 'plants']);
  assert.ok(!('client_id' in u));
  assert.ok(!('plant_ids' in u));
  const a = resolveCreate(ADMIN, { email: 'a@x.com', role: 'client_admin' });
  assert.deepEqual(a.module_permissions, []);
});

test('rdx_admin no crea rdx_admin y rechaza email/permisos inválidos', () => {
  assert.equal(statusOf(() => resolveCreate(ADMIN, { email: 'r@x.com', role: 'rdx_admin' })), 403);
  assert.equal(statusOf(() => resolveCreate(ADMIN, { email: 'mal', role: 'client_user' })), 400);
  assert.equal(statusOf(() => resolveCreate(ADMIN, {
    email: 'u@x.com', role: 'client_user', module_permissions: ['desconocido'],
  })), 400);
  assert.equal(statusOf(() => resolveCreate(ADMIN, {
    email: 'u@x.com', role: 'client_user', module_permissions: 'plants',
  })), 400);
});

test('client_admin ya no crea usuarios en esta fase', () => {
  assert.equal(statusOf(() => resolveCreate(CA, { email: 'n@x.com', role: 'client_user' })), 403);
});

test('validateModulePermissions normaliza, dedup y exige catálogo', () => {
  assert.deepEqual(validateModulePermissions(undefined), []);
  assert.deepEqual(validateModulePermissions(null), []);
  assert.deepEqual(validateModulePermissions([]), []);
  assert.deepEqual(validateModulePermissions(['plants', 'plants', 'dashboard']), ['plants', 'dashboard']);
  assert.deepEqual(validateModulePermissions(['reports']), ['reports']);
  assert.equal(statusOf(() => validateModulePermissions('x')), 400);
  assert.equal(statusOf(() => validateModulePermissions([123])), 400);
  assert.equal(statusOf(() => validateModulePermissions(['otro'])), 400);
});

test('resolveTarget: solo rdx_admin resuelve gestionables; rdx da 404', () => {
  assert.equal(statusOf(() => resolveTarget(CU, CA)), 403);
  assert.equal(statusOf(() => resolveTarget(RDX2, ADMIN)), 404);
  assert.equal(statusOf(() => resolveTarget(null, ADMIN)), 404);
  assert.doesNotThrow(() => resolveTarget(CU, ADMIN));
  assert.doesNotThrow(() => resolveTarget(CU2, ADMIN));
});

test('rdx_admin modifica display_name, rol y permisos entre gestionables', () => {
  assert.deepEqual(resolvePatch(ADMIN, CU, { display_name: 'Nuevo' }), { display_name: 'Nuevo' });
  assert.deepEqual(resolvePatch(ADMIN, CU, { role: 'client_user' }), {});
  assert.deepEqual(resolvePatch(ADMIN, CU, { role: 'client_admin' }), { role: 'client_admin' });
  assert.deepEqual(
    resolvePatch(ADMIN, CU, { module_permissions: ['plants', 'plants'] }),
    { module_permissions: ['plants'] },
  );
  assert.equal(statusOf(() => resolvePatch(ADMIN, CU, { role: 'rdx_admin' })), 403);
  assert.equal(statusOf(() => resolvePatch(ADMIN, CU, { module_permissions: ['x'] })), 400);
  assert.equal(statusOf(() => resolvePatch(ADMIN, CU, { client_id: 'B' })), 400);
  assert.equal(statusOf(() => resolvePatch(ADMIN, CU, { plant_ids: [] })), 400);
  assert.equal(statusOf(() => resolvePatch(ADMIN, CU, { active: false })), 400);
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
