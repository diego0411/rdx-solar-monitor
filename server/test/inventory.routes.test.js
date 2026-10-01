import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(new URL('../package.json', import.meta.url));
const express = require('express');
let writes = 0;

function ok(req, res) { return res.json([]); }
function created(req, res) { writes += 1; return res.status(201).json({ ok: true }); }

mock.module('../src/controllers/inventory.controller.js', {
  namedExports: {
    listProducts: ok,
    getProduct: ok,
    postProduct: created,
    patchProduct: created,
    listItems: ok,
    postItem: created,
    postItemTransition: created,
    postQuantityMovement: created,
    listMovements: ok,
  },
});

const { default: inventoryRoutes } = await import('../src/routes/inventory.routes.js');
const { requireAuth } = await import('../src/middleware/auth.middleware.js');
const { loadProfile } = await import('../src/middleware/authorization.middleware.js');

function request(app, method, path, body = null) {
  const server = app.listen(0);
  const port = server.address().port;
  return new Promise((resolve, reject) => {
    const req = http.request({
      port, path, method, headers: body ? { 'content-type': 'application/json' } : {},
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
  app.use('/api/inventory', (req, res, next) => {
    req.profile = { id: 'actor', role, module_permissions };
    next();
  }, inventoryRoutes);
  return app;
}

test('client_admin y client_user no pueden escribir inventario', async () => {
  writes = 0;
  const paths = [
    ['/products', {}],
    ['/products/11111111-1111-4111-8111-111111111111/items', {}],
    ['/products/11111111-1111-4111-8111-111111111111/movements', {}],
    ['/items/11111111-1111-4111-8111-111111111111/transition', {}],
  ];
  for (const role of ['client_admin', 'client_user']) {
    const app = appAs(role);
    for (const [path, body] of paths) {
      assert.equal(await request(app, 'POST', `/api/inventory${path}`, body), 403);
    }
    assert.equal(await request(
      app, 'PATCH', '/api/inventory/products/11111111-1111-4111-8111-111111111111', {},
    ), 403);
  }
  assert.equal(writes, 0);
});

test('rdx_admin puede alcanzar writes y todos los roles pueden leer', async () => {
  writes = 0;
  const adminApp = appAs('rdx_admin');
  assert.equal(await request(adminApp, 'POST', '/api/inventory/products', {}), 201);
  assert.equal(writes, 1);
  for (const role of ['rdx_admin', 'client_admin']) {
    assert.equal(await request(appAs(role), 'GET', '/api/inventory/products'), 200);
  }
  assert.equal(await request(appAs('client_user', ['inventory']), 'GET', '/api/inventory/products'), 200);
  assert.equal(await request(appAs('client_user', []), 'GET', '/api/inventory/products'), 403);
});

test('las rutas de inventario exigen autenticación en el montaje real', async () => {
  const app = express();
  app.use('/api/inventory', requireAuth, loadProfile, inventoryRoutes);
  assert.equal(await request(app, 'GET', '/api/inventory/products'), 401);
});
