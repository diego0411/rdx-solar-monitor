import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../package.json', import.meta.url));
const express = require('express');
const http = (await import('node:http')).default;
const { default: clientsRoutes } = await import('../src/routes/clients.routes.js');
const { getClients } = await import('../src/controllers/clients.controller.js');

function appAs(role) {
  return null;
}

async function getStatus(app, path) {
  const server = app.listen(0);
  const port = server.address().port;
  const status = await new Promise((resolve) => {
    const r = http.request({ port, path, method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    r.on('error', () => resolve(-1));
    r.end();
  });
  server.close();
  return status;
}

test('client_admin y client_user reciben 403 en GET /api/clients', async () => {
  const { requireRoles } = await import('../src/middleware/authorization.middleware.js');
  for (const role of ['client_admin', 'client_user']) {
    let status = 200;
    let nexted = false;
    requireRoles('rdx_admin')(
      { profile: { role } },
      { status: (c) => ({ json: () => { status = c; } }) },
      () => { nexted = true; },
    );
    assert.equal(status, 403);
    assert.equal(nexted, false);
  }
  let nexted = false;
  requireRoles('rdx_admin')(
    { profile: { role: 'rdx_admin' } },
    { status: () => { throw new Error('no debe responder'); } },
    () => { nexted = true; },
  );
  assert.equal(nexted, true);
});

test('rdx_admin obtiene lista (vacía o no) sin filtrar por rol', async () => {
  let body = null;
  let status = 200;
  await getClients(
    { scope: { client_id: null, plantIds: null } },
    {
      status(c) { status = c; return { json: (p) => { body = p; } }; },
      json(p) { body = p; },
    },
  );
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
  assert.ok(body.every(c => Object.keys(c).sort().join(',') === 'id,name'));
});

test('router de clientes exige autenticación (401 sin token)', async () => {
  const app = express();
  app.use('/api/clients', clientsRoutes);
  assert.equal(await getStatus(app, '/api/clients'), 401);
});
