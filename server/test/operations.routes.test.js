import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(new URL('../package.json', import.meta.url));
const express = require('express');

async function stub() { return { ok: true }; }

mock.module('../src/services/operations.service.js', {
  namedExports: {
    listMaterialRequests: stub,
    getMaterialRequestDetail: stub,
    createMaterialRequest: stub,
    transitionMaterialRequest: stub,
    prepareSerializedItem: stub,
    releaseSerializedItem: stub,
    setPreparedQuantity: stub,
    cancelMaterialRequest: stub,
    deliverMaterialRequest: stub,
    listAvailableProducts: stub,
    listAvailableSerials: stub,
    resolveIdempotencyKey: (value) => value ?? 'generated',
    mapOperationsDatabaseError: (error) => error,
  },
});

const { default: operationsRoutes } = await import('../src/routes/operations.routes.js');
const { requireAuth } = await import('../src/middleware/auth.middleware.js');
const { loadProfile } = await import('../src/middleware/authorization.middleware.js');

const REQUEST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LINE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';

function request(app, method, path, body = null, headers = {}) {
  const server = app.listen(0);
  const port = server.address().port;
  return new Promise((resolve, reject) => {
    const req = http.request({
      port, path, method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    }, res => {
      res.resume();
      res.on('end', () => {
        server.close();
        resolve(res.statusCode);
      });
    });
    req.on('error', error => { server.close(); reject(error); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function appAs(role, module_permissions = []) {
  const app = express();
  app.use(express.json());
  app.use('/api/operations', (req, res, next) => {
    req.profile = { id: 'actor', role, module_permissions };
    req.scope = { client_id: null, plantIds: null };
    next();
  }, operationsRoutes);
  return app;
}

test('8. módulo operations requerido para client_user; bypass por rol admin', async () => {
  assert.equal(await request(appAs('client_user', []), 'GET', '/api/operations/requests'), 403);
  assert.equal(await request(appAs('client_user', ['inventory']), 'GET', '/api/operations/requests'), 403);
  assert.equal(await request(appAs('client_user', ['operations']), 'GET', '/api/operations/requests'), 200);
  assert.equal(await request(appAs('rdx_admin'), 'GET', '/api/operations/requests'), 200);
  assert.equal(await request(appAs('client_admin'), 'GET', '/api/operations/requests'), 200);
  assert.equal(await request(appAs('client_user', ['operations']), 'GET', '/api/operations/products'), 200);
});

test('client_user con módulo no puede procesar almacén', async () => {
  const app = appAs('client_user', ['operations']);
  assert.equal(await request(
    app, 'POST', `/api/operations/requests/${REQUEST_ID}/transition`, { target_status: 'received' },
  ), 403);
  assert.equal(await request(
    app, 'POST', `/api/operations/requests/${REQUEST_ID}/lines/${LINE_ID}/serials`, { inventory_item_id: ITEM_ID },
  ), 403);
  assert.equal(await request(
    app, 'DELETE', `/api/operations/requests/${REQUEST_ID}/lines/${LINE_ID}/serials/${ITEM_ID}`,
  ), 403);
  assert.equal(await request(
    app, 'PATCH', `/api/operations/requests/${REQUEST_ID}/lines/${LINE_ID}/prepared-quantity`,
    { prepared_quantity: 1 },
  ), 403);
  assert.equal(await request(
    app, 'POST', `/api/operations/requests/${REQUEST_ID}/deliver`, { deliveries: {} },
  ), 403);
  assert.equal(await request(
    app, 'GET', `/api/operations/requests/${REQUEST_ID}/lines/${LINE_ID}/available-items`,
  ), 403);
  // Crear y cancelar sí pasan el gate de rol (la propiedad la decide el servicio).
  assert.equal(await request(app, 'POST', '/api/operations/requests', { reason: 'other', lines: [] }), 201);
  assert.equal(await request(app, 'POST', `/api/operations/requests/${REQUEST_ID}/cancel`, {}), 200);
});

test('client_admin alcanza procesamiento y lectura', async () => {
  const app = appAs('client_admin');
  assert.equal(await request(
    app, 'POST', `/api/operations/requests/${REQUEST_ID}/transition`, { target_status: 'received' },
  ), 200);
  assert.equal(await request(
    app, 'POST', `/api/operations/requests/${REQUEST_ID}/lines/${LINE_ID}/serials`, { inventory_item_id: ITEM_ID },
  ), 201);
  assert.equal(await request(
    app, 'POST', `/api/operations/requests/${REQUEST_ID}/deliver`, { deliveries: {} },
  ), 200);
  assert.equal(await request(
    app, 'GET', `/api/operations/requests/${REQUEST_ID}/lines/${LINE_ID}/available-items`,
  ), 200);
});

test('las rutas de operaciones exigen autenticación en el montaje real', async () => {
  const app = express();
  app.use('/api/operations', requireAuth, loadProfile, operationsRoutes);
  assert.equal(await request(app, 'GET', '/api/operations/requests'), 401);
});
