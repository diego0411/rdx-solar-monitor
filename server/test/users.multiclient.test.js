import test, { beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const actors = {
  admin: { id: 'admin', role: 'rdx_admin', client_id: null, active: true },
  manager: { id: 'manager', role: 'client_admin', client_id: 'client-a', active: true },
  'inactive-manager': { id: 'inactive-manager', role: 'client_admin', client_id: 'client-off', active: true },
};
const PASSWORD = 'Test-only-Password-42!';
const USER_ID = '00000000-0000-4000-8000-000000000002';
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
  if (url.pathname === '/rest/v1/clients') {
    if (method === 'GET' && url.searchParams.has('id')) {
      const id = eqParam(url, 'id');
      const found = state.clients.find(client => client.id === id);
      return json(found ? { ...found } : null);
    }
    const active = state.clients.filter(client => client.active);
    return json(active.map(({ id, name }) => ({ id, name })));
  }
  if (url.pathname === '/rest/v1/client_plants') return json([]);
  if (url.pathname === '/rest/v1/user_profiles') {
    if (method === 'POST') {
      const profile = { ...(Array.isArray(body) ? body[0] : body), created_at: '2026-01-01T00:00:00Z' };
      state.profiles.push(profile);
      return json(profile);
    }
    const id = eqParam(url, 'id');
    return json(id ? actors[id] ?? state.profiles.find(profile => profile.id === id) ?? null : state.profiles);
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
    clients: [
      { id: 'client-a', name: 'Cliente A', active: true },
      { id: 'client-b', name: 'Cliente B', active: true },
      { id: 'client-off', name: 'Inactivo', active: false },
    ],
    authUsers: [],
    profiles: [],
  };
});

async function request(t, actor, body, method = 'POST') {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/users`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(actor ? { Authorization: `Bearer ${actor}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

const payload = (overrides = {}) => ({
  name: 'Nuevo', email: 'new@example.test', role: 'client_user', password: PASSWORD, ...overrides,
});

test('rdx_admin crea client_user y client_admin con client_id válido', async t => {
  for (const role of ['client_user', 'client_admin']) {
    const result = await request(t, 'admin', payload({ email: `${role}@example.test`, role, client_id: 'client-a' }));
    assert.equal(result.status, 201);
    assert.equal(result.body.client_id, 'client-a');
    assert.equal(result.body.role, role);
  }
});

test('client_id inexistente o inactivo se rechaza', async t => {
  const missing = await request(t, 'admin', payload({ client_id: 'no-existe' }));
  assert.equal(missing.status, 400);
  const inactive = await request(t, 'admin', payload({ client_id: 'client-off' }));
  assert.equal(inactive.status, 400);
});

test('sin client_id y múltiples activos no se resuelve', async t => {
  const result = await request(t, 'admin', payload());
  assert.equal(result.status, 400);
});

test('sin client_id y un único activo conserva fallback', async t => {
  state.clients = [{ id: 'client-a', name: 'Cliente A', active: true }];
  const result = await request(t, 'admin', payload());
  assert.equal(result.status, 201);
  assert.equal(result.body.client_id, 'client-a');
});

test('client_admin no amplía scope aunque pida otro cliente', async t => {
  const result = await request(t, 'manager', payload({ email: 'other@example.test', client_id: 'client-b' }));
  assert.equal(result.status, 201);
  assert.equal(result.body.client_id, 'client-a');
});

test('usuario de cliente inactivo recibe 403', async t => {
  const listed = await request(t, 'inactive-manager', null, 'GET');
  assert.equal(listed.status, 403);
  assert.deepEqual(listed.body, { error: 'Cliente inactivo' });
  const created = await request(t, 'inactive-manager', payload({ email: 'x@example.test' }));
  assert.equal(created.status, 403);
});
