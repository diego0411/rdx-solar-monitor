import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

// loadProfile real contra transporte aislado: el scope nuevo proviene solo
// de user_plants; clients/client_plants no deben consultarse jamás.
const profiles = {
  admin: { id: 'admin', role: 'rdx_admin', client_id: null, active: true },
  manager: { id: 'manager', role: 'client_admin', client_id: 'legacy-fisico', active: true },
  reader: { id: 'reader', role: 'client_user', client_id: 'legacy-fisico', active: true },
  empty: { id: 'empty', role: 'client_user', client_id: null, active: true },
  off: { id: 'off', role: 'client_user', client_id: null, active: false },
  strange: { id: 'strange', role: 'viewer', client_id: null, active: true },
};
const PLANT_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const PLANT_B = 'bbbbbbbb-2222-4222-8222-222222222222';
const grants = [
  { user_id: 'manager', plant_id: PLANT_A },
  { user_id: 'manager', plant_id: PLANT_B },
  { user_id: 'reader', plant_id: PLANT_A },
];
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
  if (url.pathname === '/rest/v1/user_plants') {
    const userId = eqParam(url, 'user_id');
    return json(grants.filter(grant => grant.user_id === userId).map(({ plant_id }) => ({ plant_id })));
  }
  throw new Error(`Lectura prohibida en auth nuevo: ${url.pathname}`);
}

const supabase = createClient('https://supabase.invalid', 'test-service-role', {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport },
});
mock.module('../src/config/supabase.js', { exports: { supabase } });
const { loadProfile, plantInScope } = await import('../src/middleware/authorization.middleware.js');

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

test('rdx_admin obtiene scope global sin leer grants', async () => {
  const result = await scopeOf('admin');
  assert.equal(result.nexted, true);
  assert.equal(result.req.scope.plantIds, null);
  assert.ok(!result.reads.includes('/rest/v1/user_plants'));
});

test('client_admin y client_user obtienen scope desde user_plants', async () => {
  const manager = await scopeOf('manager');
  assert.equal(manager.nexted, true);
  assert.deepEqual([...manager.req.scope.plantIds].sort(), [PLANT_A, PLANT_B].sort());
  const reader = await scopeOf('reader');
  assert.deepEqual([...reader.req.scope.plantIds], [PLANT_A]);
});

test('clients/client_plants no participan en loadProfile', async () => {
  for (const actor of ['manager', 'reader', 'empty']) {
    const result = await scopeOf(actor);
    assert.equal(result.nexted, true);
    assert.ok(!result.reads.some(path => path.includes('clients') && !path.includes('user_plants')));
  }
});

test('usuario sin grants obtiene scope vacío y planta ajena se deniega', async () => {
  const result = await scopeOf('empty');
  assert.equal(result.nexted, true);
  assert.equal(result.req.scope.plantIds.size, 0);
  assert.equal(plantInScope(result.req.scope, PLANT_A), false);
  const reader = await scopeOf('reader');
  assert.equal(plantInScope(reader.req.scope, PLANT_A), true);
  assert.equal(plantInScope(reader.req.scope, PLANT_B), false);
  assert.equal(plantInScope({ plantIds: null }, PLANT_B), true);
});

test('perfil inactivo y rol desconocido se rechazan sin scope', async () => {
  const off = await scopeOf('off');
  assert.equal(off.nexted, false);
  assert.equal(off.status, 403);
  const strange = await scopeOf('strange');
  assert.equal(strange.nexted, false);
  assert.equal(strange.status, 403);
  const missing = await scopeOf('ghost');
  assert.equal(missing.nexted, false);
  assert.equal(missing.status, 403);
});
