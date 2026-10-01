import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

// loadProfile real contra transporte aislado: scope global para todos los
// roles; clients/client_plants/user_plants no deben consultarse jamás.
const profiles = {
  admin: { id: 'admin', role: 'rdx_admin', client_id: null, active: true, module_permissions: [] },
  manager: { id: 'manager', role: 'client_admin', client_id: 'legacy-fisico', active: true, module_permissions: [] },
  reader: {
    id: 'reader', role: 'client_user', client_id: 'legacy-fisico', active: true,
    module_permissions: ['dashboard', 'plants', 'devices'],
  },
  empty: { id: 'empty', role: 'client_user', client_id: null, active: true, module_permissions: [] },
  off: { id: 'off', role: 'client_user', client_id: null, active: false, module_permissions: [] },
  strange: { id: 'strange', role: 'viewer', client_id: null, active: true, module_permissions: [] },
};
const reads = [];

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

function eqParam(url, name) {
  const raw = url.searchParams.get(name);
  if (!raw) return null;
  return decodeURIComponent(raw).replace(/^eq\./, '');
}

async function transport(input, options = {}) {
  const url = new URL(input);
  reads.push(url.pathname);
  if (url.pathname === '/rest/v1/user_profiles') {
    return json(profiles[eqParam(url, 'id')] ?? null);
  }
  throw new Error(`Lectura prohibida en auth nuevo: ${url.pathname}`);
}

const supabase = createClient('https://supabase.invalid', 'test-service-role', {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport },
});
mock.module('../src/config/supabase.js', { exports: { supabase } });
const { loadProfile, plantInScope, requireModuleAccess } = await import('../src/middleware/authorization.middleware.js');

async function scopeOf(actor) {
  reads.length = 0;
  const req = { user: { id: actor }, scope: undefined };
  let status = null; let body = null; let nexted = false;
  const res = {
    status(code) { status = code; return this; },
    json(payload) { body = payload; return this; },
  };
  await loadProfile(req, res, () => { nexted = true; });
  return { req, status, body, nexted, reads: [...reads] };
}

function gateResult(profile, ...modules) {
  const req = { profile };
  let status = null; let nexted = false;
  const res = {
    status(code) { status = code; return this; },
    json() { return this; },
  };
  requireModuleAccess(...modules)(req, res, () => { nexted = true; });
  return { nexted, status };
}

test('todos los roles obtienen plantIds null (scope global)', async () => {
  for (const actor of ['admin', 'manager', 'reader', 'empty']) {
    const result = await scopeOf(actor);
    assert.equal(result.nexted, true);
    assert.equal(result.req.scope.plantIds, null);
    assert.equal(plantInScope(result.req.scope, 'cualquier-planta'), true);
  }
});

test('clients/client_plants/user_plants no participan en loadProfile', async () => {
  for (const actor of ['admin', 'manager', 'reader', 'empty']) {
    const result = await scopeOf(actor);
    assert.equal(result.nexted, true);
    assert.deepEqual(result.reads, ['/rest/v1/user_profiles']);
  }
});

test('perfil incluye module_permissions para el frontend', async () => {
  const result = await scopeOf('reader');
  assert.deepEqual(result.req.profile.module_permissions, ['dashboard', 'plants', 'devices']);
});

test('rdx_admin y client_admin hacen bypass de módulos', () => {
  assert.equal(gateResult({ role: 'rdx_admin' }, 'inventory').nexted, true);
  assert.equal(gateResult({ role: 'client_admin' }, 'inventory').nexted, true);
});

test('client_user con permiso pasa; sin permiso recibe 403', () => {
  const allowed = gateResult({ role: 'client_user', module_permissions: ['maintenance'] }, 'maintenance');
  assert.equal(allowed.nexted, true);
  const denied = gateResult({ role: 'client_user', module_permissions: ['plants'] }, 'maintenance');
  assert.equal(denied.nexted, false);
  assert.equal(denied.status, 403);
  const empty = gateResult({ role: 'client_user', module_permissions: [] }, 'dashboard');
  assert.equal(empty.nexted, false);
});

test('rol desconocido o sin perfil se deniega', () => {
  assert.equal(gateResult({ role: 'viewer' }, 'dashboard').nexted, false);
  assert.equal(gateResult(null, 'dashboard').nexted, false);
});

test('perfil inactivo y ausente se rechazan sin scope', async () => {
  const off = await scopeOf('off');
  assert.equal(off.nexted, false);
  assert.equal(off.status, 403);
  const missing = await scopeOf('ghost');
  assert.equal(missing.nexted, false);
  assert.equal(missing.status, 403);
});
