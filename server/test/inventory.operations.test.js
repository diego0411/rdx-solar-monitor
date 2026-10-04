import test, { beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import http from 'node:http';

const OP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROD_Q = '11111111-1111-4111-8111-111111111111';
const PROD_S = '22222222-2222-4222-8222-222222222222';
const ACTOR = '99999999-9999-4999-8999-999999999999';
const KEY_1 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const RDX_ADMIN = { id: ACTOR, role: 'rdx_admin' };
const CLIENT_ADMIN = { id: '88888888-8888-4888-8888-888888888888', role: 'client_admin' };
const CLIENT_USER = { id: '77777777-7777-4777-8777-777777777777', role: 'client_user' };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function dbError(message, code = 'P0001') {
  const error = new Error(message);
  error.dbCode = code;
  error.dbMessage = message;
  return error;
}

// ---- Mocks de repositorio para tests de servicio ----
const repoCalls = [];
const repoState = { operation: null, lines: [], nextError: null };

function maybeThrow() {
  if (repoState.nextError) {
    const error = repoState.nextError;
    repoState.nextError = null;
    throw error;
  }
}

mock.module('../src/repositories/inventory.operations.repository.js', {
  namedExports: {
    async listInventoryOperations(filters = {}) {
      maybeThrow();
      repoCalls.push({ method: 'list', filters });
      return [{ id: OP_ID, operation_type: 'IN', status: 'draft' }];
    },
    async getInventoryOperationById(id) {
      maybeThrow();
      repoCalls.push({ method: 'get', id });
      return repoState.operation;
    },
    async listInventoryOperationLines(operationId) {
      maybeThrow();
      repoCalls.push({ method: 'lines', operationId });
      return repoState.lines;
    },
    async listInventoryOperationLinesByOperationIds(ids) {
      maybeThrow();
      repoCalls.push({ method: 'linesBatch', ids });
      return repoState.lines;
    },
    async listOperationProductsByIds(ids) {
      maybeThrow();
      repoCalls.push({ method: 'products', ids });
      return ids.map(id => ({
        id, name: 'Prod', category: 'other', tracking_mode: 'quantity', unit: 'unit',
      }));
    },
    async rpcInventoryOperationCreate(args) {
      maybeThrow();
      repoCalls.push({ method: 'create', args });
      return { id: OP_ID, status: 'draft', ...args };
    },
    async rpcInventoryOperationConfirm(args) {
      maybeThrow();
      repoCalls.push({ method: 'confirm', args });
      return { id: args.operationId, status: 'confirmed' };
    },
    async rpcInventoryOperationCancel(args) {
      maybeThrow();
      repoCalls.push({ method: 'cancel', args });
      return { id: args.operationId, status: 'cancelled' };
    },
  },
});

const service = await import('../src/services/inventory.operations.service.js');

beforeEach(() => {
  repoCalls.length = 0;
  repoState.operation = null;
  repoState.lines = [];
  repoState.nextError = null;
});

function validBody() {
  return {
    operation_type: 'IN',
    operation_date: '2026-10-03',
    reference: 'REF-1',
    notes: 'nota',
    lines: [
      { product_id: PROD_Q, quantity: 10 },
      { product_id: PROD_S, quantity: 2, serial_numbers: ['S1', 'S2'] },
    ],
  };
}

test('create exige writer: client_user 403 sin llamar RPC', async () => {
  await assert.rejects(
    service.createInventoryOperationDoc(CLIENT_USER, validBody(), null),
    error => error.statusCode === 403,
  );
  assert.deepEqual(repoCalls, []);
});

test('create rdx_admin llama RPC con actor, payload y key reutilizada', async () => {
  const result = await service.createInventoryOperationDoc(RDX_ADMIN, validBody(), KEY_1);
  assert.equal(result.status, 'draft');
  assert.equal(repoCalls.length, 1);
  const { method, args } = repoCalls[0];
  assert.equal(method, 'create');
  assert.deepEqual(args, {
    actorId: ACTOR,
    operationType: 'IN',
    lines: [
      { product_id: PROD_Q, quantity: 10 },
      { product_id: PROD_S, quantity: 2, serial_numbers: ['S1', 'S2'] },
    ],
    operationDate: '2026-10-03',
    reference: 'REF-1',
    notes: 'nota',
    idempotencyKey: KEY_1,
  });
});

test('create client_admin permitido; sin key se genera UUID servidor', async () => {
  await service.createInventoryOperationDoc(CLIENT_ADMIN, validBody(), null);
  assert.equal(repoCalls.length, 1);
  assert.match(repoCalls[0].args.idempotencyKey, uuidPattern);
});

test('create valida payload superficial sin llamar RPC', async () => {
  await assert.rejects(
    service.createInventoryOperationDoc(RDX_ADMIN, { ...validBody(), operation_type: 'RETURN' }, null),
    error => error.statusCode === 400,
  );
  await assert.rejects(
    service.createInventoryOperationDoc(RDX_ADMIN, { ...validBody(), lines: [] }, null),
    error => error.statusCode === 400,
  );
  await assert.rejects(
    service.createInventoryOperationDoc(
      RDX_ADMIN, { ...validBody(), lines: [{ product_id: 'no-uuid', quantity: 1 }] }, null,
    ),
    error => error.statusCode === 400,
  );
  await assert.rejects(
    service.createInventoryOperationDoc(RDX_ADMIN, validBody(), 'no-uuid'),
    error => error.statusCode === 400,
  );
  assert.deepEqual(repoCalls, []);
});

test('confirm llama SOLO al RPC confirm con actor y key', async () => {
  const result = await service.confirmInventoryOperationDoc(RDX_ADMIN, OP_ID, KEY_1);
  assert.equal(result.status, 'confirmed');
  assert.deepEqual(repoCalls, [{
    method: 'confirm',
    args: { operationId: OP_ID, actorId: ACTOR, idempotencyKey: KEY_1 },
  }]);
});

test('confirm exige writer e id válido', async () => {
  await assert.rejects(
    service.confirmInventoryOperationDoc(CLIENT_USER, OP_ID, KEY_1),
    error => error.statusCode === 403,
  );
  await assert.rejects(
    service.confirmInventoryOperationDoc(RDX_ADMIN, 'xxx', KEY_1),
    error => error.statusCode === 400,
  );
  assert.deepEqual(repoCalls, []);
});

test('cancel llama SOLO al RPC cancel', async () => {
  const result = await service.cancelInventoryOperationDoc(CLIENT_ADMIN, OP_ID, KEY_1);
  assert.equal(result.status, 'cancelled');
  assert.deepEqual(repoCalls, [{
    method: 'cancel',
    args: { operationId: OP_ID, actorId: CLIENT_ADMIN.id, idempotencyKey: KEY_1 },
  }]);
  await assert.rejects(
    service.cancelInventoryOperationDoc(CLIENT_USER, OP_ID, KEY_1),
    error => error.statusCode === 403,
  );
});

test('mapeo de errores 033 a HTTP', async () => {
  const cases = [
    ['ACCESS_DENIED', 403],
    ['OPERATION_NOT_FOUND', 404],
    ['INVALID_OPERATION_TYPE', 400],
    ['INVALID_TRACKING_MODE', 400],
    ['INVALID_STATUS', 409],
    ['INSUFFICIENT_STOCK', 409],
    ['SERIAL_ALREADY_EXISTS', 409],
    ['ALREADY_CONFIRMED', 409],
    ['ALREADY_CANCELLED', 409],
    ['IDEMPOTENCY_CONFLICT', 409],
  ];
  for (const [token, status] of cases) {
    repoState.nextError = dbError(token);
    await assert.rejects(
      service.confirmInventoryOperationDoc(RDX_ADMIN, OP_ID, KEY_1),
      error => error.statusCode === status,
      token,
    );
  }
  repoState.nextError = new Error('boom desconocido');
  await assert.rejects(
    service.confirmInventoryOperationDoc(RDX_ADMIN, OP_ID, KEY_1),
    error => error.statusCode === 503,
  );
});

test('list adjunta líneas y producto en batch único sin N+1', async () => {
  repoState.lines = [
    { id: 'l1', operation_id: OP_ID, product_id: PROD_Q },
    { id: 'l2', operation_id: OP_ID, product_id: PROD_S },
  ];
  const rows = await service.listInventoryOperationDocs(RDX_ADMIN, { status: 'draft' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].line_count, 2);
  assert.equal(rows[0].lines[0].product.name, 'Prod');
  assert.deepEqual(repoCalls.filter(call => call.method === 'linesBatch').length, 1);
  assert.deepEqual(repoCalls.filter(call => call.method === 'products').length, 1);
  assert.deepEqual(repoCalls.find(call => call.method === 'list').filters, { status: 'draft' });
});

test('detail 404 si no existe; incluye producto por línea', async () => {
  repoState.operation = null;
  await assert.rejects(
    service.getInventoryOperationDoc(RDX_ADMIN, OP_ID),
    error => error.statusCode === 404,
  );
  repoState.operation = { id: OP_ID, status: 'draft' };
  repoState.lines = [{ id: 'l1', operation_id: OP_ID, product_id: PROD_Q }];
  const detail = await service.getInventoryOperationDoc(RDX_ADMIN, OP_ID);
  assert.equal(detail.operation.id, OP_ID);
  assert.equal(detail.lines[0].product.tracking_mode, 'quantity');
});

test('servicio de operaciones no escribe stock directo', () => {
  const raw = readFileSync(
    new URL('../src/services/inventory.operations.service.js', import.meta.url), 'utf8',
  );
  // Sin comentarios: solo importan menciones en prosa, no accesos.
  const source = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(source, /\.from\(/);
  assert.doesNotMatch(source, /supabase/);
  assert.doesNotMatch(source, /inventory_movements/);
  assert.doesNotMatch(source, /inventory_items/);
});

// ---- Mocks de servicio para tests de controlador y rutas ----
const serviceCalls = [];
let serviceNextError = null;
let serviceResult = { ok: true };

function serviceStub(result) {
  return async (...args) => {
    if (serviceNextError) {
      const error = serviceNextError;
      serviceNextError = null;
      throw error;
    }
    serviceCalls.push(args);
    return result;
  };
}

mock.module('../src/services/inventory.operations.service.js', {
  namedExports: {
    listInventoryOperationDocs: serviceStub([{ id: OP_ID }]),
    getInventoryOperationDoc: serviceStub({ operation: { id: OP_ID }, lines: [] }),
    createInventoryOperationDoc: serviceStub({ id: OP_ID, status: 'draft' }),
    confirmInventoryOperationDoc: serviceStub({ id: OP_ID, status: 'confirmed' }),
    cancelInventoryOperationDoc: serviceStub({ id: OP_ID, status: 'cancelled' }),
  },
});

const controller = await import('../src/controllers/inventory.controller.js');

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function fakeReq({ profile = RDX_ADMIN, params = {}, query = {}, body = {}, headers = {} } = {}) {
  return {
    profile,
    params,
    query,
    body,
    get(name) {
      const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
      return key ? headers[key] : undefined;
    },
  };
}

function coded(statusCode, message = 'x') {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

test('controlador create 201 reutiliza Idempotency-Key del header', async () => {
  serviceCalls.length = 0;
  const res = fakeRes();
  await controller.postOperation(
    fakeReq({ body: validBody(), headers: { 'Idempotency-Key': KEY_1 } }), res,
  );
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.status, 'draft');
  assert.deepEqual(serviceCalls[0], [RDX_ADMIN, validBody(), KEY_1]);
});

test('controlador create usa body.idempotency_key si no hay header; null si ausente', async () => {
  serviceCalls.length = 0;
  await controller.postOperation(
    fakeReq({ body: { ...validBody(), idempotency_key: KEY_1 } }), fakeRes(),
  );
  assert.deepEqual(serviceCalls[0][2], KEY_1);
  serviceCalls.length = 0;
  await controller.postOperation(fakeReq({ body: validBody() }), fakeRes());
  assert.equal(serviceCalls[0][2], null);
});

test('controlador confirm/cancel 200 y mapeo de errores', async () => {
  serviceCalls.length = 0;
  let res = fakeRes();
  await controller.postOperationConfirm(fakeReq({ params: { id: OP_ID } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(serviceCalls[0], [RDX_ADMIN, OP_ID, null]);

  res = fakeRes();
  await controller.postOperationCancel(
    fakeReq({ params: { id: OP_ID }, headers: { 'Idempotency-Key': KEY_1 } }), res,
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(serviceCalls[1], [RDX_ADMIN, OP_ID, KEY_1]);

  serviceNextError = coded(409, 'Stock insuficiente');
  res = fakeRes();
  await controller.postOperationConfirm(fakeReq({ params: { id: OP_ID } }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'Stock insuficiente');

  serviceNextError = coded(403, 'Acceso denegado');
  res = fakeRes();
  await controller.postOperation(fakeReq({ body: validBody() }), res);
  assert.equal(res.statusCode, 403);

  serviceNextError = new Error('fallo raro');
  res = fakeRes();
  await controller.postOperation(fakeReq({ body: validBody() }), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'Error interno');
});

test('controlador detail propaga 404', async () => {
  serviceNextError = coded(404, 'Operación no encontrada');
  const res = fakeRes();
  await controller.getOperation(fakeReq({ params: { id: OP_ID } }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'Operación no encontrada');
});

// ---- Rutas con express ----
const require = createRequire(new URL('../package.json', import.meta.url));
const express = require('express');

const { default: inventoryRoutes } = await import('../src/routes/inventory.routes.js');

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

function appAs(role, modulePermissions = []) {
  const app = express();
  app.use(express.json());
  app.use('/api/inventory', (req, res, next) => {
    req.profile = { id: ACTOR, role, module_permissions: modulePermissions };
    req.scope = { client_id: null, plantIds: null };
    next();
  }, inventoryRoutes);
  return app;
}

test('rutas operations: lectura por módulo, escritura solo rdx_admin/client_admin', async () => {
  assert.equal(await request(appAs('client_user', []), 'GET', '/api/inventory/operations'), 403);
  assert.equal(
    await request(appAs('client_user', ['inventory']), 'GET', '/api/inventory/operations'), 200,
  );
  assert.equal(
    await request(appAs('client_user', ['inventory']), 'POST', '/api/inventory/operations', validBody()),
    403,
  );
  assert.equal(
    await request(appAs('client_admin'), 'POST', '/api/inventory/operations', validBody()), 201,
  );
  assert.equal(
    await request(appAs('rdx_admin'), 'POST', `/api/inventory/operations/${OP_ID}/confirm`, {}),
    200,
  );
  assert.equal(
    await request(appAs('client_user', ['inventory']), 'POST', `/api/inventory/operations/${OP_ID}/cancel`, {}),
    403,
  );
});
