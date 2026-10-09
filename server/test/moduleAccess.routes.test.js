import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createClient } from '@supabase/supabase-js';

// Gates reales requireModuleAccess montados en routers reales, con
// controladores stub. Prueba la autoridad backend, no el menú.
const actors = {
  admin: { id: 'admin', role: 'rdx_admin', client_id: null, active: true, module_permissions: [] },
  manager: { id: 'manager', role: 'client_admin', client_id: null, active: true, module_permissions: [] },
  reader: {
    id: 'reader', role: 'client_user', client_id: null, active: true,
    module_permissions: ['dashboard', 'plants', 'devices'],
  },
  bare: { id: 'bare', role: 'client_user', client_id: null, active: true, module_permissions: [] },
  maintainer: {
    id: 'maintainer', role: 'client_user', client_id: null, active: true,
    module_permissions: ['maintenance'],
  },
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

function eqParam(url, name) {
  const raw = url.searchParams.get(name);
  if (!raw) return null;
  return decodeURIComponent(raw).replace(/^eq\./, '');
}

async function transport(input, options = {}) {
  const url = new URL(input);
  if (url.pathname === '/auth/v1/user') {
    const actor = new Headers(options.headers).get('authorization')?.replace('Bearer ', '');
    return actors[actor] ? json({ id: actor }) : json({ message: 'Unauthorized' }, 401);
  }
  if (url.pathname === '/rest/v1/user_profiles') {
    return json(actors[eqParam(url, 'id')] ?? null);
  }
  throw new Error(`Unexpected test transport request: ${url.pathname}`);
}

const supabase = createClient('https://supabase.invalid', 'test-service-role', {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport },
});
mock.module('../src/config/supabase.js', { exports: { supabase } });

function ok(req, res) { return res.json({ ok: true }); }
mock.module('../src/controllers/maintenance.controller.js', {
  namedExports: {
    listMaintenance: ok, getMaintenance: ok, postMaintenance: ok, patchMaintenance: ok,
    patchMaintenanceStatus: ok, postActivity: ok, patchActivity: ok, deleteActivity: ok,
  },
});
mock.module('../src/controllers/inventory.controller.js', {
  namedExports: {
    listProducts: ok, getProduct: ok, postProduct: ok, patchProduct: ok, listItems: ok,
    postItem: ok, postItemTransition: ok, postQuantityMovement: ok, listMovements: ok,
    listOperations: ok, getOperation: ok, postOperation: ok, postOperationConfirm: ok,
    postOperationCancel: ok,
  },
});
mock.module('../src/controllers/dashboard.controller.js', { namedExports: { getSummary: ok } });
mock.module('../src/controllers/devices.controller.js', {
  namedExports: { getDevices: ok, getDevicesLatestData: ok, getDeviceDetail: ok, getDevicesCatalog: ok },
});
mock.module('../src/controllers/plants.controller.js', {
  namedExports: { getPlants: ok, getPlantEnergySummaries: ok, getOverview: ok, getPlantDetailOverview: ok },
});

const { requireAuth } = await import('../src/middleware/auth.middleware.js');
const { loadProfile } = await import('../src/middleware/authorization.middleware.js');
const { default: maintenanceRoutes } = await import('../src/routes/maintenance.routes.js');
const { default: inventoryRoutes } = await import('../src/routes/inventory.routes.js');
const { default: dashboardRoutes } = await import('../src/routes/dashboard.routes.js');
const { default: devicesRoutes } = await import('../src/routes/devices.routes.js');
const { default: plantsRoutes } = await import('../src/routes/plants.routes.js');
const { default: authRoutes } = await import('../src/routes/auth.routes.js');

const app = express();
app.use(express.json());
app.use('/api/maintenance', requireAuth, loadProfile, maintenanceRoutes);
app.use('/api/inventory', requireAuth, loadProfile, inventoryRoutes);
app.use('/api/dashboard', requireAuth, loadProfile, dashboardRoutes);
app.use('/api/devices', requireAuth, loadProfile, devicesRoutes);
app.use('/api/plants', requireAuth, loadProfile, plantsRoutes);
app.use('/api/auth', authRoutes);

async function get(t, actor, path) {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    headers: actor ? { Authorization: `Bearer ${actor}` } : {},
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

test('rdx_admin y client_admin bypassan módulos; client_user requiere grant', async t => {
  for (const actor of ['admin', 'manager']) {
    assert.equal((await get(t, actor, '/api/maintenance')).status, 200);
    assert.equal((await get(t, actor, '/api/inventory/products')).status, 200);
  }
  assert.equal((await get(t, 'reader', '/api/maintenance')).status, 403);
  assert.equal((await get(t, 'reader', '/api/inventory/products')).status, 403);
  assert.equal((await get(t, 'reader', '/api/dashboard/summary')).status, 200);
  assert.equal((await get(t, 'reader', '/api/devices')).status, 200);
  assert.equal((await get(t, 'reader', '/api/devices/catalog')).status, 200);
  assert.equal((await get(t, 'reader', '/api/plants')).status, 200);
  assert.equal((await get(t, 'bare', '/api/dashboard/summary')).status, 403);
});

test('permiso maintenance no concede escritura admin', async t => {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));
  const post = (actor) => fetch(`http://127.0.0.1:${server.address().port}/api/maintenance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${actor}` },
    body: JSON.stringify({}),
  });
  const deniedByModule = await post('reader');
  await deniedByModule.text();
  assert.equal(deniedByModule.status, 403);
  const deniedByWriter = await post('maintainer');
  await deniedByWriter.text();
  assert.equal(deniedByWriter.status, 403);
  const allowed = await post('manager');
  await allowed.text();
  assert.equal(allowed.status, 200);
});

test('/me devuelve role, active y module_permissions sin plant_ids', async t => {
  const result = await get(t, 'reader', '/api/auth/me');
  assert.equal(result.status, 200);
  assert.equal(result.body.profile.role, 'client_user');
  assert.equal(result.body.profile.active, true);
  assert.deepEqual(result.body.profile.module_permissions, ['dashboard', 'plants', 'devices']);
  assert.ok(!('plant_ids' in result.body.profile));
});
