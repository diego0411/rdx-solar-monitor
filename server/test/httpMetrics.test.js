import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import express from 'express';

import { httpMetrics, metricsEnabled, normalizeHttpRoute } from '../src/middleware/httpMetrics.middleware.js';

let getUserImpl = async () => ({ data: { user: null }, error: new Error('invalid token') });
let profileImpl = async () => ({ data: null, error: null });

mock.module('../src/config/supabase.js', {
  namedExports: {
    supabase: {
      auth: { getUser: async (...args) => getUserImpl(...args) },
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => profileImpl() }) }),
      }),
    },
  },
});

const { requireAuth } = await import('../src/middleware/auth.middleware.js');
const { loadProfile } = await import('../src/middleware/authorization.middleware.js');

function captureLogs(t) {
  const entries = [];
  const original = console.info;
  console.info = (...args) => { entries.push(args); };
  t.after(() => { console.info = original; });
  return entries;
}

async function startApp(t, configure) {
  const app = express();
  app.use(express.json());
  app.use(httpMetrics);
  configure(app);
  const server = await new Promise(resolve => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started));
  });
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

function metric(entries) {
  const found = entries.filter(args => args[0] === 'http_metric').map(args => args[1]);
  assert.equal(found.length, 1);
  return found[0];
}

test('ruta exitosa: registra método, patrón, status, duración y tamaño sin alterar la respuesta', async t => {
  process.env.HTTP_METRICS_ENABLED = 'true';
  t.after(() => { delete process.env.HTTP_METRICS_ENABLED; });
  const entries = captureLogs(t);
  const base = await startApp(t, app => {
    const router = express.Router();
    router.get('/:plantId/overview', (req, res) => res.json({ ok: true }));
    app.use('/api/plants', router);
  });

  const plantId = 'c9a3c08b-f517-40d4-bd1a-5f9763efa887';
  const res = await fetch(`${base}/api/plants/${plantId}/overview`, {
    headers: { authorization: 'Bearer secreto-token' },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  const entry = metric(entries);
  assert.equal(entry.method, 'GET');
  assert.equal(entry.route, '/api/plants/:plantId/overview');
  assert.equal(entry.status, 200);
  assert.equal(typeof entry.duration_ms, 'number');
  assert.ok(entry.duration_ms >= 0);
  assert.equal(typeof entry.response_bytes, 'number');
  const serialized = JSON.stringify(entries);
  assert.ok(!serialized.includes(plantId));
  assert.ok(!serialized.includes('secreto-token'));
});

test('ruta con error: registra el status sin alterar el cuerpo', async t => {
  process.env.HTTP_METRICS_ENABLED = 'true';
  t.after(() => { delete process.env.HTTP_METRICS_ENABLED; });
  const entries = captureLogs(t);
  const base = await startApp(t, app => {
    app.get('/api/falla', (req, res) => res.status(500).json({ error: 'x' }));
  });

  const res = await fetch(`${base}/api/falla`);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'x' });

  const entry = metric(entries);
  assert.equal(entry.method, 'GET');
  assert.equal(entry.route, '/api/falla');
  assert.equal(entry.status, 500);
});

test('desactivada por defecto: no registra nada y deja pasar', async t => {
  delete process.env.HTTP_METRICS_ENABLED;
  const entries = captureLogs(t);
  const base = await startApp(t, app => {
    app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  });

  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
  assert.equal(entries.filter(args => args[0] === 'http_metric').length, 0);
  assert.equal(metricsEnabled(), false);
});

test('ruta sin coincidencia: redacta UUID y no expone query ni cuerpo', async t => {
  process.env.HTTP_METRICS_ENABLED = 'true';
  t.after(() => { delete process.env.HTTP_METRICS_ENABLED; });
  const entries = captureLogs(t);
  const base = await startApp(t, () => {});

  const uuid = 'c9a3c08b-f517-40d4-bd1a-5f9763efa887';
  const res = await fetch(
    `${base}/api/plants/${uuid}/overview?token=secreto&password=clave`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer otro-secreto' },
      body: JSON.stringify({ password: 'clave-cuerpo' }),
    },
  );
  assert.equal(res.status, 404);

  const entry = metric(entries);
  assert.equal(entry.route, '/api/plants/:id/overview');
  assert.equal(entry.status, 404);
  const serialized = JSON.stringify(entries);
  for (const secret of [uuid, 'secreto', 'clave-cuerpo', 'otro-secreto', 'password']) {
    assert.ok(!serialized.includes(secret), `fuga detectada: ${secret}`);
  }
});

test('normalizeHttpRoute prefiere el patrón Express y redacta el fallback', () => {
  assert.equal(
    normalizeHttpRoute({ baseUrl: '/api/plants', route: { path: '/:plantId/overview' }, path: '/x' }),
    '/api/plants/:plantId/overview',
  );
  assert.equal(
    normalizeHttpRoute({ baseUrl: '', route: undefined, path: '/api/alarms/12345' }),
    '/api/alarms/:id',
  );
  assert.equal(
    normalizeHttpRoute({ baseUrl: '', route: undefined, path: '/api/health' }),
    '/api/health',
  );
});

function fakeContext(headers = {}) {
  const req = { get: name => headers[name.toLowerCase()] ?? undefined };
  const res = {
    locals: {},
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  let nextCalled = false;
  const next = () => { nextCalled = true; };
  return { req, res, next, nextCalled: () => nextCalled };
}

const adminProfile = {
  id: 'admin-1', client_id: null, role: 'rdx_admin',
  display_name: 'Admin', active: true, module_permissions: [],
};

function enableMetrics(t) {
  process.env.HTTP_METRICS_ENABLED = 'true';
  t.after(() => { delete process.env.HTTP_METRICS_ENABLED; });
  getUserImpl = async () => ({ data: { user: null }, error: new Error('invalid token') });
  profileImpl = async () => ({ data: null, error: null });
}

test('requireAuth exitoso mide auth_ms sin alterar el flujo', async t => {
  enableMetrics(t);
  getUserImpl = async token => {
    assert.equal(token, 'tok-abc');
    return { data: { user: { id: 'admin-1' } }, error: null };
  };
  const { req, res, next, nextCalled } = fakeContext({ authorization: 'Bearer tok-abc' });
  await requireAuth(req, res, next);
  assert.equal(nextCalled(), true);
  assert.deepEqual(req.user, { id: 'admin-1' });
  assert.equal(typeof res.locals.auth_ms, 'number');
  assert.ok(res.locals.auth_ms >= 0);
});

test('requireAuth 401 también mide auth_ms y deja la respuesta intacta', async t => {
  enableMetrics(t);
  const { req, res, next, nextCalled } = fakeContext({ authorization: 'Bearer invalido' });
  await requireAuth(req, res, next);
  assert.equal(nextCalled(), false);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'No autorizado' });
  assert.equal(typeof res.locals.auth_ms, 'number');
});

test('loadProfile exitoso mide profile_ms sin alterar el flujo', async t => {
  enableMetrics(t);
  profileImpl = async () => ({ data: adminProfile, error: null });
  const { req, res, next, nextCalled } = fakeContext();
  req.user = { id: 'admin-1' };
  await loadProfile(req, res, next);
  assert.equal(nextCalled(), true);
  assert.equal(req.profile.role, 'rdx_admin');
  assert.equal(typeof res.locals.profile_ms, 'number');
  assert.ok(res.locals.profile_ms >= 0);
});

test('loadProfile 403 también mide profile_ms y deja la respuesta intacta', async t => {
  enableMetrics(t);
  profileImpl = async () => ({ data: { ...adminProfile, active: false }, error: null });
  const { req, res, next, nextCalled } = fakeContext();
  req.user = { id: 'admin-1' };
  await loadProfile(req, res, next);
  assert.equal(nextCalled(), false);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'Perfil inactivo' });
  assert.equal(typeof res.locals.profile_ms, 'number');
});

test('métricas desactivadas: sin marcas en locals y flujo intacto', async t => {
  delete process.env.HTTP_METRICS_ENABLED;
  getUserImpl = async () => ({ data: { user: { id: 'admin-1' } }, error: null });
  profileImpl = async () => ({ data: adminProfile, error: null });
  const first = fakeContext({ authorization: 'Bearer tok' });
  await requireAuth(first.req, first.res, first.next);
  assert.equal(first.nextCalled(), true);
  assert.deepEqual(Object.keys(first.res.locals), []);
  const second = fakeContext();
  second.req.user = { id: 'admin-1' };
  await loadProfile(second.req, second.res, second.next);
  assert.equal(second.nextCalled(), true);
  assert.deepEqual(Object.keys(second.res.locals), []);
});

test('integración: http_metric incluye auth_ms y profile_ms sin sensibles', async t => {
  enableMetrics(t);
  getUserImpl = async () => ({ data: { user: { id: 'admin-1' } }, error: null });
  profileImpl = async () => ({ data: adminProfile, error: null });
  const entries = captureLogs(t);
  const app = express();
  app.use(express.json());
  app.use(httpMetrics);
  app.use(requireAuth);
  app.use(loadProfile);
  app.get('/api/users', (req, res) => res.json([{ id: 'admin-1' }]));
  const server = await new Promise(resolve => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started));
  });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${base}/api/users`, {
    headers: { authorization: 'Bearer tok-secreto', 'x-mail': 'admin@example.com' },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), [{ id: 'admin-1' }]);

  const entry = metric(entries);
  assert.equal(entry.route, '/api/users');
  assert.equal(entry.status, 200);
  assert.equal(typeof entry.auth_ms, 'number');
  assert.equal(typeof entry.profile_ms, 'number');
  assert.ok(entry.auth_ms >= 0 && entry.profile_ms >= 0);
  assert.ok(entry.duration_ms >= entry.auth_ms);
  const serialized = JSON.stringify(entries);
  for (const secret of ['tok-secreto', 'admin@example.com', 'Admin']) {
    assert.ok(!serialized.includes(secret), `fuga detectada: ${secret}`);
  }
});

test('integración 401: conserva auth_ms sin profile_ms y respuesta intacta', async t => {
  enableMetrics(t);
  const entries = captureLogs(t);
  const app = express();
  app.use(express.json());
  app.use(httpMetrics);
  app.use(requireAuth);
  app.use(loadProfile);
  app.get('/api/users', (req, res) => res.json([]));
  const server = await new Promise(resolve => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started));
  });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${base}/api/users`, {
    headers: { authorization: 'Bearer invalido' },
  });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: 'No autorizado' });

  const entry = metric(entries);
  assert.equal(entry.status, 401);
  assert.equal(typeof entry.auth_ms, 'number');
  assert.ok(!('profile_ms' in entry));
});
