import test, { beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const actors = {
  admin: { id: 'admin', role: 'rdx_admin', client_id: null, active: true },
  manager: { id: 'manager', role: 'client_admin', client_id: 'client-a', active: true },
  reader: { id: 'reader', role: 'client_user', client_id: 'client-a', active: true },
};
let state;

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

async function transport(input, options = {}) {
  const url = new URL(input);
  if (url.pathname === '/auth/v1/user') {
    const token = new Headers(options.headers).get('authorization')?.replace('Bearer ', '');
    return actors[token] ? json({ id: token }) : json({ message: 'Unauthorized' }, 401);
  }
  if (url.pathname === '/rest/v1/user_profiles') {
    const id = url.searchParams.get('id')?.replace('eq.', '');
    return json(actors[id] ?? null);
  }
  if (url.pathname === '/rest/v1/clients') {
    if (state.clientsError) return json({ message: 'database secret' }, 500);
    return json(state.clients.filter(client => client.active).map(({ id, name }) => ({ id, name })));
  }
  if (url.pathname === '/rest/v1/client_plants') {
    if (url.searchParams.has('client_id')) return json([]);
    state.assignmentRequests += 1;
    if (state.assignmentsError) return json({ message: 'database secret' }, 500);
    const rows = [...state.assignments].sort((left, right) =>
      left.client_id.localeCompare(right.client_id) || left.plant_id.localeCompare(right.plant_id));
    const start = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 1000);
    const end = start + limit - 1;
    const page = rows.slice(start, end + 1);
    return json(page, 200, { 'Content-Range': `${start}-${start + page.length - 1}/${rows.length}` });
  }
  throw new Error(`Unexpected test transport request: ${url.pathname}`);
}

const supabase = createClient('https://supabase.invalid', 'test-service-role', {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: transport },
});
mock.module('../src/config/supabase.js', { exports: { supabase } });
const { default: clientsRoutes } = await import('../src/routes/clients.routes.js');
const app = express();
app.use('/api/clients', clientsRoutes);

beforeEach(() => {
  state = {
    clients: [
      { id: 'client-a', name: 'Cliente A', active: true },
      { id: 'client-b', name: 'Cliente B', active: true },
      { id: 'client-off', name: 'Inactivo', active: false },
    ],
    assignments: [],
    assignmentRequests: 0,
    clientsError: false,
    assignmentsError: false,
  };
});

async function request(t, actor, path = '/api/clients') {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    headers: actor ? { Authorization: `Bearer ${actor}` } : {},
  });
  return { status: response.status, body: await response.json() };
}

test('GET /clients conserva exactamente id,name y no consulta relaciones', async t => {
  const result = await request(t, 'admin');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, [
    { id: 'client-a', name: 'Cliente A' },
    { id: 'client-b', name: 'Cliente B' },
  ]);
  assert.ok(result.body.every(client => Object.keys(client).sort().join(',') === 'id,name'));
  assert.equal(state.assignmentRequests, 0);
});

test('include=plant_ids usa client_plants, soporta relación compartida y cliente vacío', async t => {
  state.assignments = [
    { client_id: 'client-b', plant_id: 'plant-shared' },
    { client_id: 'client-a', plant_id: 'plant-z' },
    { client_id: 'client-a', plant_id: 'plant-shared' },
    { client_id: 'client-off', plant_id: 'plant-hidden' },
  ];
  const result = await request(t, 'admin', '/api/clients?include=plant_ids');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, [
    { id: 'client-a', name: 'Cliente A', plant_ids: ['plant-shared', 'plant-z'] },
    { id: 'client-b', name: 'Cliente B', plant_ids: ['plant-shared'] },
  ]);

  state.assignments = [];
  const empty = await request(t, 'admin', '/api/clients?include=plant_ids');
  assert.deepEqual(empty.body.map(client => client.plant_ids), [[], []]);
});

test('client_plants se pagina sin truncar relaciones', async t => {
  state.clients = [{ id: 'client-a', name: 'Cliente A', active: true }];
  state.assignments = Array.from({ length: 1001 }, (_, index) => ({
    client_id: 'client-a', plant_id: `plant-${String(index).padStart(4, '0')}`,
  }));
  const result = await request(t, 'admin', '/api/clients?include=plant_ids');
  assert.equal(result.status, 200);
  assert.equal(result.body[0].plant_ids.length, 1001);
  assert.equal(state.assignmentRequests, 2);
});

test('include desconocido devuelve 400 sin consultar relaciones', async t => {
  const result = await request(t, 'admin', '/api/clients?include=plants');
  assert.equal(result.status, 400);
  assert.deepEqual(result.body, { error: 'include inválido' });
  assert.equal(state.assignmentRequests, 0);
});

test('client_admin y client_user continúan sin acceso', async t => {
  for (const actor of ['manager', 'reader']) {
    const result = await request(t, actor, '/api/clients?include=plant_ids');
    assert.equal(result.status, 403);
    assert.deepEqual(result.body, { error: 'Acceso denegado' });
  }
});

test('errores de repository se sanitizan', async t => {
  state.assignmentsError = true;
  const result = await request(t, 'admin', '/api/clients?include=plant_ids');
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { error: 'No se pudieron consultar los clientes' });
  assert.doesNotMatch(JSON.stringify(result.body), /database secret/i);
});

test('router de clientes exige autenticación', async t => {
  const result = await request(t, null);
  assert.equal(result.status, 401);
});
