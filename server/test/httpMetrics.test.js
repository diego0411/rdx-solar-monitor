import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';

import { httpMetrics, metricsEnabled, normalizeHttpRoute } from '../src/middleware/httpMetrics.middleware.js';

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
