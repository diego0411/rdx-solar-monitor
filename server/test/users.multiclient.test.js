import test, { beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const actors = {
  admin: { id: 'admin', role: 'rdx_admin', client_id: null, active: true },
  manager: { id: 'manager', role: 'client_admin', client_id: 'legacy-fisico', active: true },
  reader: { id: 'reader', role: 'client_user', client_id: 'legacy-fisico', active: true },
  inactive: { id: 'inactive', role: 'client_user', client_id: null, active: false },
};
const PASSWORD = 'Test-only-Password-42!';
const USER_ID = '00000000-0000-4000-8000-000000000002';
const PLANT_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const PLANT_B = 'bbbbbbbb-2222-4222-8222-222222222222';
const U1 = '11111111-1111-4111-8111-0000000000a1';
const R1 = '11111111-1111-4111-8111-0000000000a2';
let state;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'X-Supabase-Api-Version': '2024-01-01' },
});

function eqParam(url, name) {
  const raw = url.searchParams.get(name);
  if (!raw) return null;
  return decodeURIComponent(raw).replace(/^eq\./, '');
}

async function transport(input, options = {}) {
  const url = new URL(input);
  const method = options.method ?? 'GET';
  const body = options.body ? JSON.parse(options.body) : null;
  if (url.pathname === '/auth/v1/user') {
    const actor = new Headers(options.headers).get('authorization')?.replace('Bearer ', '');
    return actors[actor] ? json({ id: actor }) : json({ message: 'Unauthorized' }, 401);
  }
  if (url.pathname === '/auth/v1/admin/users' && method === 'POST') {
    if (state.authUsers.some(user => user.email === body.email)) {
      return json({ code: 'email_exists', msg: 'Already registered' }, 422);
    }
    const user = { id: USER_ID, email: body.email, user_metadata: body.user_metadata };
    state.authUsers.push(user);
    return json(user);
  }
  if (url.pathname === '/auth/v1/admin/users' && method === 'GET') {
    return json({ users: state.authUsers, aud: 'authenticated' });
  }
  if (url.pathname === '/rest/v1/user_profiles') {
    if (method === 'POST') {
      const profile = { ...(Array.isArray(body) ? body[0] : body), created_at: '2026-01-01T00:00:00Z' };
      state.profiles.push(profile);
      return json(profile);
    }
    if (method === 'PATCH') {
      const id = eqParam(url, 'id');
      const target = state.profiles.find(profile => profile.id === id);
      if (!target) return json(null);
      Object.assign(target, Array.isArray(body) ? body[0] : body);
      return json({ ...target });
    }
    const id = eqParam(url, 'id');
    return json(id ? actors[id] ?? state.profiles.find(profile => profile.id === id) ?? null : state.profiles);
  }
  if (url.pathname === '/rest/v1/user_plants') {
    if (method === 'DELETE') {
      const userId = eqParam(url, 'user_id');
      state.grants = state.grants.filter(grant => grant.user_id !== userId);
      return json([]);
    }
    if (method === 'POST') {
      const rows = (Array.isArray(body) ? body : [body]).map(row => ({ ...row }));
      state.grants.push(...rows);
      return json(rows.map(({ plant_id }) => ({ plant_id })), 201);
    }
    const userId = eqParam(url, 'user_id');
    const rows = state.grants.filter(grant => !userId || grant.user_id === userId);
    return json(rows.map(({ user_id, plant_id }) => ({ user_id, plant_id })));
  }
  if (url.pathname === '/rest/v1/plants') {
    if (method === 'GET' && url.searchParams.has('id')) {
      const id = eqParam(url, 'id');
      const plant = state.plants.find(item => item.id === id);
      return json(plant ? { ...plant } : null);
    }
    return json(state.plants);
  }
  throw new Error(`Unexpected test transport request: ${method} ${url.pathname}`);
}

const supabase = createClient('https://supabase.invalid', 'test-service-role', {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport },
});
mock.module('../src/config/supabase.js', { exports: { supabase } });
const { default: usersRoutes } = await import('../src/routes/users.routes.js');
const app = express();
app.use(express.json());
app.use('/api/users', usersRoutes);
await new Promise(resolve => setImmediate(resolve));

beforeEach(() => {
  state = {
    authUsers: [],
    profiles: [],
    grants: [],
    plants: [{ id: PLANT_A }, { id: PLANT_B }],
  };
});

async function request(t, actor, path = '/api/users', options = {}) {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(actor ? { Authorization: `Bearer ${actor}` } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

const payload = (overrides = {}) => ({
  name: 'Nuevo', email: 'new@example.test', role: 'client_user', password: PASSWORD, ...overrides,
});

test('rdx_admin crea client_user y client_admin sin client_id', async t => {
  for (const role of ['client_user', 'client_admin']) {
    const result = await request(t, 'admin', '/api/users', {
      method: 'POST', body: payload({ email: `${role}@example.test`, role }),
    });
    assert.equal(result.status, 201);
    assert.equal(result.body.role, role);
    assert.ok(!('client_id' in result.body));
    assert.deepEqual(result.body.plant_ids, []);
  }
});

test('creación con plant_ids válidos otorga scope; inexistente se rechaza', async t => {
  const ok = await request(t, 'admin', '/api/users', {
    method: 'POST', body: payload({ plant_ids: [PLANT_A, PLANT_B, PLANT_A] }),
  });
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.body.plant_ids, [PLANT_A, PLANT_B]);
  const missing = await request(t, 'admin', '/api/users', {
    method: 'POST', body: payload({ email: 'bad@example.test', plant_ids: ['no-uuid'] }),
  });
  assert.equal(missing.status, 400);
  const unknown = await request(t, 'admin', '/api/users', {
    method: 'POST',
    body: payload({ email: 'ghost@example.test', plant_ids: ['99999999-9999-4999-8999-999999999999'] }),
  });
  assert.equal(unknown.status, 400);
});

test('no-rdx_admin no administra usuarios en esta fase', async t => {
  for (const actor of ['manager', 'reader']) {
    assert.equal((await request(t, actor, '/api/users', { method: 'POST', body: payload() })).status, 403);
    assert.equal((await request(t, actor)).status, 403);
  }
});

test('PATCH plants reemplaza el conjunto; [] vacía el scope', async t => {
  state.profiles.push({ id: U1, role: 'client_user', active: true, created_at: '2026-01-01T00:00:00Z' });
  state.grants.push({ user_id: U1, plant_id: PLANT_A });
  const replaced = await request(t, 'admin', `/api/users/${U1}/plants`, {
    method: 'PATCH', body: { plant_ids: [PLANT_B] },
  });
  assert.equal(replaced.status, 200);
  assert.deepEqual(replaced.body.plant_ids, [PLANT_B]);
  const emptied = await request(t, 'admin', `/api/users/${U1}/plants`, {
    method: 'PATCH', body: { plant_ids: [] },
  });
  assert.equal(emptied.status, 200);
  assert.deepEqual(emptied.body.plant_ids, []);
  assert.deepEqual(state.grants, []);
});

test('PATCH plants valida rol, plantas e id', async t => {
  state.profiles.push({ id: U1, role: 'client_user', active: true, created_at: '2026-01-01T00:00:00Z' });
  state.profiles.push({ id: R1, role: 'rdx_admin', active: true, created_at: '2026-01-01T00:00:00Z' });
  assert.equal((await request(t, 'admin', `/api/users/${R1}/plants`, {
    method: 'PATCH', body: { plant_ids: [PLANT_A] },
  })).status, 400);
  assert.equal((await request(t, 'admin', `/api/users/${U1}/plants`, {
    method: 'PATCH', body: { plant_ids: ['no-uuid'] },
  })).status, 400);
  assert.equal((await request(t, 'admin', `/api/users/${U1}/plants`, { method: 'PATCH', body: {} })).status, 400);
  assert.equal((await request(t, 'admin', '/api/users/no-uuid/plants', {
    method: 'PATCH', body: { plant_ids: [] },
  })).status, 400);
  assert.equal((await request(t, 'manager', `/api/users/${U1}/plants`, {
    method: 'PATCH', body: { plant_ids: [] },
  })).status, 403);
});

test('perfil inactivo recibe 403 aunque el cliente legacy exista físicamente', async t => {
  const listed = await request(t, 'inactive');
  assert.equal(listed.status, 403);
  assert.deepEqual(listed.body, { error: 'Perfil inactivo' });
});

test('cambio lateral conserva grants; rdx_admin no es asignable ni objetivo', async t => {
  state.profiles.push({ id: U1, role: 'client_user', active: true, created_at: '2026-01-01T00:00:00Z' });
  state.grants.push({ user_id: U1, plant_id: PLANT_A });
  const lateral = await request(t, 'admin', `/api/users/${U1}`, {
    method: 'PATCH', body: { role: 'client_admin' },
  });
  assert.equal(lateral.status, 200);
  assert.deepEqual(lateral.body.plant_ids, [PLANT_A]);
  assert.equal((await request(t, 'admin', `/api/users/${U1}`, {
    method: 'PATCH', body: { role: 'rdx_admin' },
  })).status, 403);
  assert.deepEqual(state.grants, [{ user_id: U1, plant_id: PLANT_A }]);
});
