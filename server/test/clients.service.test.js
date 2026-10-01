import test, { beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const actors = {
  admin: { id: 'admin', role: 'rdx_admin', client_id: null, active: true },
  manager: { id: 'manager', role: 'client_admin', client_id: 'client-a', active: true },
  reader: { id: 'reader', role: 'client_user', client_id: 'client-a', active: true },
  legacy: { id: 'legacy', role: 'client_user', client_id: '99999999-9999-4999-8999-000000000009', active: true },
};
let state;

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function fullClient(client) {
  return {
    id: client.id,
    name: client.name,
    phone: client.phone ?? null,
    email: client.email ?? null,
    is_commercial: client.is_commercial ?? true,
    active: client.active,
    created_at: client.created_at ?? '2026-01-01T00:00:00Z',
    updated_at: client.updated_at ?? '2026-01-01T00:00:00Z',
  };
}

function eqParam(url, name) {
  const raw = url.searchParams.get(name);
  if (!raw) return null;
  return decodeURIComponent(raw).replace(/^eq\./, '');
}

async function transport(input, options = {}) {
  const url = new URL(input);
  const method = options.method ?? 'GET';
  if (url.pathname === '/auth/v1/user') {
    const token = new Headers(options.headers).get('authorization')?.replace('Bearer ', '');
    return actors[token] ? json({ id: token }) : json({ message: 'Unauthorized' }, 401);
  }
  if (url.pathname === '/rest/v1/user_profiles') {
    const id = eqParam(url, 'id');
    return json(actors[id] ?? null);
  }
  if (url.pathname === '/rest/v1/user_plants') {
    return json([]);
  }
  if (url.pathname === '/rest/v1/plants') {
    if (method === 'GET' && url.searchParams.has('id')) {
      const id = eqParam(url, 'id');
      const plant = state.plants.find(item => item.id === id);
      return json(plant ? { id: plant.id } : null);
    }
    return json(state.plants.map(({ id }) => ({ id })));
  }
  if (url.pathname === '/rest/v1/clients') {
    if (state.clientsError) return json({ message: 'database secret' }, 500);
    if (method === 'POST') {
      const body = options.body ? JSON.parse(options.body) : {};
      const payload = Array.isArray(body) ? body[0] : body;
      state.clientSeq += 1;
      const created = {
        id: `00000000-0000-4000-8000-${String(state.clientSeq).padStart(12, '0')}`,
        name: payload?.name,
        phone: payload?.phone ?? null,
        email: payload?.email ?? null,
        is_commercial: true,
        active: true,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };
      state.clients.push(created);
      return json(fullClient(created), 201);
    }
    if (method === 'PATCH') {
      const id = eqParam(url, 'id');
      const body = options.body ? JSON.parse(options.body) : {};
      const target = state.clients.find(client => client.id === id);
      if (!target) return json(null);
      if (body.name !== undefined) target.name = body.name;
      if (body.phone !== undefined) target.phone = body.phone;
      if (body.email !== undefined) target.email = body.email;
      if (body.active !== undefined) target.active = body.active;
      target.updated_at = '2026-01-02T00:00:00Z';
      return json(fullClient(target));
    }
    if (method === 'GET' && url.searchParams.has('id')) {
      const id = eqParam(url, 'id');
      const found = state.clients.find(client => client.id === id);
      return json(found ? fullClient(found) : null);
    }
    if (url.searchParams.has('active')) {
      const onlyCommercial = eqParam(url, 'is_commercial') === 'true';
      return json(state.clients
        .filter(client => client.active && (!onlyCommercial || client.is_commercial !== false))
        .map(({ id, name }) => ({ id, name })));
    }
    const onlyCommercial = eqParam(url, 'is_commercial') === 'true';
    const rows = [...state.clients]
      .filter(client => !onlyCommercial || client.is_commercial !== false)
      .sort((left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
    const start = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 1000);
    const end = start + limit - 1;
    const page = rows.slice(start, end + 1).map(fullClient);
    return json(page, 200, { 'Content-Range': `${start}-${start + page.length - 1}/${rows.length}` });
  }
  if (url.pathname === '/rest/v1/client_plants') {
    if (method === 'POST') {
      const body = options.body ? JSON.parse(options.body) : {};
      const payload = Array.isArray(body) ? body[0] : body;
      const existing = state.assignments.find(item =>
        item.client_id === payload?.client_id && item.plant_id === payload?.plant_id);
      if (existing) return json(existing, 201);
      const created = {
        client_id: payload?.client_id,
        plant_id: payload?.plant_id,
        assigned_at: '2026-01-01T00:00:00Z',
      };
      state.assignments.push(created);
      return json(created, 201);
    }
    if (url.searchParams.has('client_id')) {
      const clientId = eqParam(url, 'client_id');
      return json(state.assignments
        .filter(item => item.client_id === clientId)
        .map(({ plant_id }) => ({ plant_id })));
    }
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
  throw new Error(`Unexpected test transport request: ${method} ${url.pathname}`);
}

const supabase = createClient('https://supabase.invalid', 'test-service-role', {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: transport },
});
mock.module('../src/config/supabase.js', { exports: { supabase } });
const { default: clientsRoutes } = await import('../src/routes/clients.routes.js');
const app = express();
app.use(express.json());
app.use('/api/clients', clientsRoutes);

beforeEach(() => {
  state = {
    clients: [
      { id: '11111111-1111-4111-8111-000000000001', name: 'Cliente A', active: true, is_commercial: true },
      { id: '11111111-1111-4111-8111-000000000002', name: 'Cliente B', active: true, is_commercial: true },
      { id: '11111111-1111-4111-8111-000000000003', name: 'Inactivo', active: false, is_commercial: true },
      { id: '99999999-9999-4999-8999-000000000009', name: 'Nexora', active: true, is_commercial: false },
    ],
    plants: [
      { id: '22222222-2222-4222-8222-000000000001' },
      { id: '22222222-2222-4222-8222-000000000002' },
    ],
    assignments: [],
    assignmentRequests: 0,
    clientsError: false,
    assignmentsError: false,
    clientSeq: 100,
  };
  actors.manager.client_id = '11111111-1111-4111-8111-000000000001';
  actors.reader.client_id = '11111111-1111-4111-8111-000000000001';
});

async function request(t, actor, path = '/api/clients', options = {}) {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(actor ? { Authorization: `Bearer ${actor}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

const CLIENT_A = '11111111-1111-4111-8111-000000000001';
const CLIENT_B = '11111111-1111-4111-8111-000000000002';
const CLIENT_OFF = '11111111-1111-4111-8111-000000000003';

test('GET /clients conserva exactamente id,name y no consulta relaciones', async t => {
  const result = await request(t, 'admin');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, [
    { id: CLIENT_A, name: 'Cliente A' },
    { id: CLIENT_B, name: 'Cliente B' },
  ]);
  assert.ok(result.body.every(client => Object.keys(client).sort().join(',') === 'id,name'));
  assert.equal(state.assignmentRequests, 0);
});

test('include=plant_ids usa client_plants, soporta relación compartida y cliente vacío', async t => {
  state.assignments = [
    { client_id: CLIENT_B, plant_id: 'plant-shared' },
    { client_id: CLIENT_A, plant_id: 'plant-z' },
    { client_id: CLIENT_A, plant_id: 'plant-shared' },
    { client_id: CLIENT_OFF, plant_id: 'plant-hidden' },
  ];
  const result = await request(t, 'admin', '/api/clients?include=plant_ids');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, [
    { id: CLIENT_A, name: 'Cliente A', plant_ids: ['plant-shared', 'plant-z'] },
    { id: CLIENT_B, name: 'Cliente B', plant_ids: ['plant-shared'] },
  ]);

  state.assignments = [];
  const empty = await request(t, 'admin', '/api/clients?include=plant_ids');
  assert.deepEqual(empty.body.map(client => client.plant_ids), [[], []]);
});

test('client_plants se pagina sin truncar relaciones', async t => {
  state.clients = [{ id: CLIENT_A, name: 'Cliente A', active: true }];
  state.assignments = Array.from({ length: 1001 }, (_, index) => ({
    client_id: CLIENT_A, plant_id: `plant-${String(index).padStart(4, '0')}`,
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

const PLANT_1 = '22222222-2222-4222-8222-000000000001';
const PLANT_2 = '22222222-2222-4222-8222-000000000002';

test('status=all incluye activos e inactivos con active y plant_ids', async t => {
  state.assignments = [{ client_id: CLIENT_A, plant_id: PLANT_1 }];
  const result = await request(t, 'admin', '/api/clients?status=all&include=plant_ids');
  assert.equal(result.status, 200);
  assert.equal(result.body.length, 3);
  const byId = Object.fromEntries(result.body.map(client => [client.id, client]));
  assert.deepEqual(byId[CLIENT_A].plant_ids, [PLANT_1]);
  assert.deepEqual(byId[CLIENT_B].plant_ids, []);
  assert.equal(byId[CLIENT_OFF].active, false);
  assert.ok(result.body.every(client =>
    ['active', 'id', 'name', 'plant_ids'].every(key => key in client)));
});

test('status inválido devuelve 400', async t => {
  const result = await request(t, 'admin', '/api/clients?status=inactive');
  assert.equal(result.status, 400);
  assert.deepEqual(result.body, { error: 'status inválido' });
});

test('POST crea cliente con trim y activo', async t => {
  const result = await request(t, 'admin', '/api/clients', {
    method: 'POST', body: { name: '  Nuevo  ' },
  });
  assert.equal(result.status, 201);
  assert.equal(result.body.name, 'Nuevo');
  assert.equal(result.body.active, true);
});

test('POST rechaza nombre vacío, largo y duplicado case-insensitive', async t => {
  for (const name of ['', '   ', 'a'.repeat(121)]) {
    const result = await request(t, 'admin', '/api/clients', { method: 'POST', body: { name } });
    assert.equal(result.status, 400);
  }
  const dupe = await request(t, 'admin', '/api/clients', { method: 'POST', body: { name: 'cliente a' } });
  assert.equal(dupe.status, 409);
  assert.doesNotMatch(JSON.stringify(dupe.body), /database secret/i);
});

test('PATCH renombra y 404 si no existe', async t => {
  const renamed = await request(t, 'admin', `/api/clients/${CLIENT_A}`, {
    method: 'PATCH', body: { name: 'Renombrado' },
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.name, 'Renombrado');
  const missing = await request(t, 'admin', '/api/clients/33333333-3333-4333-8333-000000000099', {
    method: 'PATCH', body: { name: 'X' },
  });
  assert.equal(missing.status, 404);
  const badId = await request(t, 'admin', '/api/clients/no-uuid', {
    method: 'PATCH', body: { name: 'X' },
  });
  assert.equal(badId.status, 400);
});

test('PATCH status desactiva conservando relaciones y permite reactivar', async t => {
  state.assignments = [{ client_id: CLIENT_A, plant_id: PLANT_1, assigned_at: '2026-01-01T00:00:00Z' }];
  const off = await request(t, 'admin', `/api/clients/${CLIENT_A}/status`, {
    method: 'PATCH', body: { active: false },
  });
  assert.equal(off.status, 200);
  assert.equal(off.body.active, false);
  assert.equal(state.assignments.length, 1);
  const on = await request(t, 'admin', `/api/clients/${CLIENT_A}/status`, {
    method: 'PATCH', body: { active: true },
  });
  assert.equal(on.status, 200);
  assert.equal(on.body.active, true);
  const bad = await request(t, 'admin', `/api/clients/${CLIENT_A}/status`, {
    method: 'PATCH', body: { active: 'si' },
  });
  assert.equal(bad.status, 400);
});

test('PUT client→plant ya no existe (catálogo comercial)', async t => {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));
  const adminResponse = await fetch(
    `http://127.0.0.1:${server.address().port}/api/clients/${CLIENT_A}/plants/${PLANT_1}`,
    { method: 'PUT', headers: { Authorization: 'Bearer admin' } },
  );
  assert.equal(adminResponse.status, 404);
  await adminResponse.text();
  const managerResponse = await fetch(
    `http://127.0.0.1:${server.address().port}/api/clients/${CLIENT_A}/plants/${PLANT_1}`,
    { method: 'PUT', headers: { Authorization: 'Bearer manager' } },
  );
  assert.equal(managerResponse.status, 403);
  await managerResponse.text();
});

test('auth nuevo ignora clients: cliente inactivo ya no bloquea el perfil', async t => {
  actors.reader.client_id = CLIENT_OFF;
  const result = await request(t, 'reader', '/api/clients?include=plant_ids');
  assert.equal(result.status, 403);
  assert.deepEqual(result.body, { error: 'Acceso denegado' });
});

test('mutaciones exigen rdx_admin', async t => {
  const cases = [
    ['/api/clients', { method: 'POST', body: { name: 'X' } }],
    [`/api/clients/${CLIENT_A}`, { method: 'PATCH', body: { name: 'X' } }],
    [`/api/clients/${CLIENT_A}/status`, { method: 'PATCH', body: { active: false } }],
  ];
  for (const actor of ['manager', 'reader']) {
    for (const [path, options] of cases) {
      const result = await request(t, actor, path, options);
      assert.equal(result.status, 403);
    }
  }
});

test('POST crea con name + phone + email aplicando trim', async t => {
  const result = await request(t, 'admin', '/api/clients', {
    method: 'POST',
    body: { name: '  Comercial  ', phone: '  70000000  ', email: '  VENTAS@example.test  ' },
  });
  assert.equal(result.status, 201);
  assert.equal(result.body.name, 'Comercial');
  assert.equal(result.body.phone, '70000000');
  assert.equal(result.body.email, 'VENTAS@example.test');
  assert.equal(result.body.active, true);
});

test('POST solo name deja phone/email en null', async t => {
  const result = await request(t, 'admin', '/api/clients', {
    method: 'POST', body: { name: 'Solo nombre' },
  });
  assert.equal(result.status, 201);
  assert.equal(result.body.phone, null);
  assert.equal(result.body.email, null);
});

test('POST normaliza "" a null y rechaza contacto inválido', async t => {
  const blank = await request(t, 'admin', '/api/clients', {
    method: 'POST', body: { name: 'Blanco', phone: '   ', email: '' },
  });
  assert.equal(blank.status, 201);
  assert.equal(blank.body.phone, null);
  assert.equal(blank.body.email, null);
  for (const body of [
    { name: 'X1', email: 'sin-arroba' },
    { name: 'X2', email: 'a@b' },
    { name: 'X3', email: 'a @b.test' },
    { name: 'X4', email: `${'a'.repeat(250)}@b.test` },
    { name: 'X5', phone: '1'.repeat(41) },
    { name: 'X6', phone: 70000000 },
    { name: 'X7', email: 42 },
  ]) {
    const result = await request(t, 'admin', '/api/clients', { method: 'POST', body });
    assert.equal(result.status, 400);
  }
});

test('POST rechaza campo desconocido y exige name', async t => {
  const extra = await request(t, 'admin', '/api/clients', {
    method: 'POST', body: { name: 'X', nit: '123' },
  });
  assert.equal(extra.status, 400);
  const missing = await request(t, 'admin', '/api/clients', {
    method: 'POST', body: { phone: '70000000' },
  });
  assert.equal(missing.status, 400);
  const empty = await request(t, 'admin', '/api/clients', { method: 'POST', body: {} });
  assert.equal(empty.status, 400);
});

test('PATCH acepta solo phone o solo email sin exigir name', async t => {
  const phone = await request(t, 'admin', `/api/clients/${CLIENT_A}`, {
    method: 'PATCH', body: { phone: '  71000000 ' },
  });
  assert.equal(phone.status, 200);
  assert.equal(phone.body.phone, '71000000');
  assert.equal(phone.body.name, 'Cliente A');
  const email = await request(t, 'admin', `/api/clients/${CLIENT_A}`, {
    method: 'PATCH', body: { email: 'contacto@example.test' },
  });
  assert.equal(email.status, 200);
  assert.equal(email.body.email, 'contacto@example.test');
});

test('PATCH contacto a "" lo deja en null y valida formato', async t => {
  state.clients.find(client => client.id === CLIENT_A).phone = '71000000';
  const cleared = await request(t, 'admin', `/api/clients/${CLIENT_A}`, {
    method: 'PATCH', body: { phone: '', email: '   ' },
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.phone, null);
  assert.equal(cleared.body.email, null);
  const bad = await request(t, 'admin', `/api/clients/${CLIENT_A}`, {
    method: 'PATCH', body: { email: 'no-es-email' },
  });
  assert.equal(bad.status, 400);
});

test('PATCH name conserva validación de duplicado aunque cambien contactos', async t => {
  const dupe = await request(t, 'admin', `/api/clients/${CLIENT_A}`, {
    method: 'PATCH', body: { name: 'cliente b', phone: '72000000' },
  });
  assert.equal(dupe.status, 409);
  const renamed = await request(t, 'admin', `/api/clients/${CLIENT_A}`, {
    method: 'PATCH', body: { name: 'Cliente A Unico', phone: '72000000' },
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.name, 'Cliente A Unico');
  assert.equal(renamed.body.phone, '72000000');
});

const NEXORA = '99999999-9999-4999-8999-000000000009';

test('GET active excluye la fila legacy no comercial', async t => {
  const result = await request(t, 'admin');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, [
    { id: CLIENT_A, name: 'Cliente A' },
    { id: CLIENT_B, name: 'Cliente B' },
  ]);
  assert.ok(!result.body.some(client => client.id === NEXORA));
});

test('status=all excluye Nexora pero incluye inactivo comercial', async t => {
  const result = await request(t, 'admin', '/api/clients?status=all');
  assert.equal(result.status, 200);
  assert.equal(result.body.length, 3);
  assert.ok(!result.body.some(client => client.id === NEXORA));
  assert.equal(result.body.find(client => client.id === CLIENT_OFF).active, false);
});

test('auth legacy sigue cargando Nexora active para su usuario', async t => {
  const result = await request(t, 'legacy');
  assert.equal(result.status, 403);
  assert.deepEqual(result.body, { error: 'Acceso denegado' });
});

test('POST crea comercial e is_commercial en body se rechaza', async t => {
  const created = await request(t, 'admin', '/api/clients', {
    method: 'POST', body: { name: 'Nuevo Comercial', phone: '70000000', email: 'c@example.test' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.is_commercial, true);
  const flagged = await request(t, 'admin', '/api/clients', {
    method: 'POST', body: { name: 'Otro', is_commercial: false },
  });
  assert.equal(flagged.status, 400);
});

test('PATCH y PATCH status sobre UUID Nexora responden 404', async t => {
  const patch = await request(t, 'admin', `/api/clients/${NEXORA}`, {
    method: 'PATCH', body: { name: 'Cambio' },
  });
  assert.equal(patch.status, 404);
  const phone = await request(t, 'admin', `/api/clients/${NEXORA}`, {
    method: 'PATCH', body: { phone: '70000000' },
  });
  assert.equal(phone.status, 404);
  const status = await request(t, 'admin', `/api/clients/${NEXORA}/status`, {
    method: 'PATCH', body: { active: false },
  });
  assert.equal(status.status, 404);
  assert.equal(state.clients.find(client => client.id === NEXORA).active, true);
});

test('duplicado de nombre considera a Nexora aunque no sea comercial', async t => {
  const post = await request(t, 'admin', '/api/clients', {
    method: 'POST', body: { name: 'NEXORA' },
  });
  assert.equal(post.status, 409);
  const rename = await request(t, 'admin', `/api/clients/${CLIENT_A}`, {
    method: 'PATCH', body: { name: 'nexora' },
  });
  assert.equal(rename.status, 409);
});

test('operación comercial no toca client_plants ni user_profiles', async t => {
  await request(t, 'admin', '/api/clients', { method: 'POST', body: { name: ' intacto ' } });
  await request(t, 'admin', `/api/clients/${CLIENT_A}`, {
    method: 'PATCH', body: { phone: '71000000' },
  });
  assert.deepEqual(state.assignments, []);
  assert.equal(actors.legacy.client_id, NEXORA);
  assert.equal(state.clients.find(client => client.id === NEXORA).is_commercial, false);
});
