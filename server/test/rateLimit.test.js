import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';

import {
  apiLimiter,
  sensitiveLimiter,
} from '../src/middleware/rateLimit.middleware.js';

async function startApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.get('/general', apiLimiter, (req, res) => res.json({ status: 'ok' }));
  app.get('/sensible', sensitiveLimiter, (req, res) => res.json({ status: 'ok' }));
  const server = await new Promise(resolve => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started));
  });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('limitador general permite tráfico normal', async t => {
  const { server, base } = await startApp();
  t.after(() => server.close());
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`${base}/general`);
    assert.equal(res.status, 200);
  }
});

test('limitador sensible responde 429 con JSON al superar el límite', async t => {
  const { server, base } = await startApp();
  t.after(() => server.close());
  let lastStatus = 0;
  let lastBody = null;
  // Límite real: 60 por ventana. 61 requests secuenciales son rápidos en local.
  for (let i = 0; i < 61; i++) {
    const res = await fetch(`${base}/sensible`);
    lastStatus = res.status;
    lastBody = await res.json();
  }
  assert.equal(lastStatus, 429);
  assert.equal(typeof lastBody?.error, 'string');
});
