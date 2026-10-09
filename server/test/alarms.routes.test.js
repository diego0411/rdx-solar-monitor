import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const PA = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const PB = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const D1 = 'd1111111-1111-4111-8111-111111111111';
const D2 = 'd2222222-2222-4222-8222-222222222222';
const A1 = 'a1111111-1111-4111-8111-111111111111';
const A2 = 'a2222222-2222-4222-8222-222222222222';
const A3 = 'a3333333-3333-4333-8333-333333333333';
const A4 = 'a4444444-4444-4334-8333-444444444444';
const A5 = 'a5555555-5555-4335-8333-555555555555';
const T0 = '2026-09-01T10:00:00.000Z';
const T1 = '2026-10-01T10:00:00.000Z';
const T2 = '2026-10-05T10:00:00.000Z';
const NOW = Date.parse('2026-10-06T12:00:00.000Z');

const rows = [
  {
    id: A1, provider: 'growatt', alarm_code: 'FAULT:5', title: 'PV isolation low', description: null,
    severity: 'critical', status: 'active', started_at: null, first_seen_at: T2, last_seen_at: T2, resolved_at: null,
    plant_id: PA, plant: { id: PA, name: 'Planta A' }, device_id: D1,
    device: { id: D1, name: 'Inversor 1', serial_number: 'MIN1', device_type: 'MIN' },
    raw_payload: { faultType: 5, auth: { access_token: 's3cr3t' }, deep: { list: [{ password: 'p' }] }, api_key: 'k', ok: 1 },
  },
  {
    id: A2, provider: 'growatt', alarm_code: 'WARN:3', title: 'Grid volt high', description: 'desc',
    severity: 'warning', status: 'active', started_at: null, first_seen_at: T1, last_seen_at: T1, resolved_at: null,
    plant_id: PA, plant: { id: PA, name: 'Planta A' }, device_id: D1,
    device: { id: D1, name: 'Inversor 1', serial_number: 'MIN1', device_type: 'MIN' },
    raw_payload: { warnCode: 3 },
  },
  {
    id: A3, provider: 'growatt', alarm_code: 'FAULT:9', title: 'Old fault', description: null,
    severity: 'critical', status: 'resolved', started_at: null, first_seen_at: T0, last_seen_at: T0,
    resolved_at: new Date(NOW - 2 * 24 * 3600 * 1000).toISOString(),
    plant_id: PB, plant: { id: PB, name: 'Planta B' }, device_id: D2,
    device: { id: D2, name: 'Inversor 2', serial_number: 'MIN2', device_type: 'MIN' },
    raw_payload: {},
  },
  {
    id: A4, provider: 'hyxi', alarm_code: 'A1', title: 'Ancient alarm', description: null,
    severity: 'warning', status: 'resolved', started_at: null, first_seen_at: T0, last_seen_at: T0,
    resolved_at: new Date(NOW - 30 * 24 * 3600 * 1000).toISOString(),
    plant_id: PB, plant: { id: PB, name: 'Planta B' }, device_id: D2,
    device: { id: D2, name: 'Inversor 2', serial_number: 'MIN2', device_type: 'MIN' },
    raw_payload: {},
  },
  {
    id: A5, provider: 'hyxi', alarm_code: 'PLANT:DOWN', title: 'Plant offline', description: null,
    severity: 'information', status: 'active', started_at: null, first_seen_at: T1, last_seen_at: T1, resolved_at: null,
    plant_id: PA, plant: { id: PA, name: 'Planta A' }, device_id: null, device: null,
    raw_payload: {},
  },
];

const repoCalls = { page: [], detail: [], summary: [] };

function scoped(all, plantIds) {
  if (plantIds === null || plantIds === undefined) return all;
  return all.filter(row => plantIds.has(row.plant_id));
}

function matches(row, f) {
  if (f.provider && row.provider !== f.provider) return false;
  if (f.status && row.status !== f.status) return false;
  if (f.severity && row.severity !== f.severity) return false;
  if (f.plantId && row.plant_id !== f.plantId) return false;
  if (f.deviceId && row.device_id !== f.deviceId) return false;
  if (f.dateFrom && row.first_seen_at < f.dateFrom) return false;
  if (f.dateTo && row.first_seen_at > f.dateTo) return false;
  if (f.search) {
    const term = f.search.toLowerCase();
    const hay = `${row.alarm_code} ${row.title} ${row.description ?? ''}`.toLowerCase();
    if (!hay.includes(term)) return false;
  }
  return true;
}

function rank(row) { return row.status === 'active' ? 0 : 1; }

mock.module('../src/repositories/alarms.repository.js', {
  namedExports: {
    async listAlarmsPage(filters) {
      repoCalls.page.push(filters);
      const filtered = scoped(rows, filters.plantIds).filter(row => matches(row, filters));
      filtered.sort((a, b) => rank(a) - rank(b) || (a.first_seen_at < b.first_seen_at ? 1 : -1) || (a.id < b.id ? 1 : -1));
      const total = filtered.length;
      const offset = (filters.page - 1) * filters.pageSize;
      return { alarms: filtered.slice(offset, offset + filters.pageSize), total };
    },
    async getAlarmDetail(id, plantIds) {
      repoCalls.detail.push({ id, plantIds });
      return scoped(rows, plantIds).find(row => row.id === id) ?? null;
    },
    async getAlarmsSummary({ plantIds, resolvedSince }) {
      repoCalls.summary.push({ plantIds, resolvedSince });
      const all = scoped(rows, plantIds);
      return {
        active: all.filter(row => row.status === 'active').length,
        critical: all.filter(row => row.status === 'active' && row.severity === 'critical').length,
        warning: all.filter(row => row.status === 'active' && row.severity === 'warning').length,
        resolved_7d: all.filter(row => row.status === 'resolved' && row.resolved_at >= resolvedSince).length,
        by_provider: {
          hyxi: all.filter(row => row.status === 'active' && row.provider === 'hyxi').length,
          growatt: all.filter(row => row.status === 'active' && row.provider === 'growatt').length,
        },
      };
    },
  },
});

// ---- App con middleware real + transporte auth falso ----
const actors = {
  admin: { id: 'admin', role: 'rdx_admin', client_id: null, active: true, module_permissions: [] },
  manager: { id: 'manager', role: 'client_admin', client_id: null, active: true, module_permissions: [] },
  reader: { id: 'reader', role: 'client_user', client_id: null, active: true, module_permissions: ['devices'] },
  bare: { id: 'bare', role: 'client_user', client_id: null, active: true, module_permissions: [] },
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

async function transport(input, options = {}) {
  const url = new URL(input);
  if (url.pathname === '/auth/v1/user') {
    const actor = new Headers(options.headers).get('authorization')?.replace('Bearer ', '');
    return actors[actor] ? json({ id: actor }) : json({ message: 'Unauthorized' }, 401);
  }
  if (url.pathname === '/rest/v1/user_profiles') {
    const id = decodeURIComponent(url.searchParams.get('id') ?? '').replace(/^eq\./, '');
    return json(actors[id] ?? null);
  }
  throw new Error(`Unexpected transport: ${url.pathname}`);
}

const supabase = createClient('https://supabase.invalid', 'test-key', {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport },
});
mock.module('../src/config/supabase.js', { exports: { supabase } });

const { requireAuth } = await import('../src/middleware/auth.middleware.js');
const { loadProfile } = await import('../src/middleware/authorization.middleware.js');
const { default: alarmsRoutes } = await import('../src/routes/alarms.routes.js');
const controller = await import('../src/controllers/alarms.controller.js');

const app = express();
app.use(express.json());
app.use('/api/alarms', requireAuth, loadProfile, alarmsRoutes);

async function get(t, actor, path) {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));
  const headers = actor ? { Authorization: `Bearer ${actor}` } : {};
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

function fakeRes() {
  const res = {};
  res.statusCode = 200;
  res.status = code => { res.statusCode = code; return res; };
  res.json = body => { res.body = body; return res; };
  return res;
}

// 1. sin auth → 401
test('1: sin auth 401', async t => {
  assert.equal((await get(t, null, '/api/alarms')).status, 401);
  assert.equal((await get(t, null, '/api/alarms/summary')).status, 401);
});

// 2. sin módulo → 403 según patrón; con devices → 200
test('2: módulo devices exige grant', async t => {
  assert.equal((await get(t, 'bare', '/api/alarms')).status, 403);
  assert.equal((await get(t, 'reader', '/api/alarms')).status, 200);
  assert.equal((await get(t, 'manager', '/api/alarms')).status, 200);
});

// 3/12/13/17. lista admin: todo, paginación, orden, sin raw
test('3/12/13/17: admin lista con paginación y orden active primero', async t => {
  const { status, body } = await get(t, 'admin', '/api/alarms?page=2&pageSize=2');
  assert.equal(status, 200);
  assert.equal(body.pagination.total, 5);
  assert.equal(body.pagination.total_pages, 3);
  assert.equal(body.alarms.length, 2);
  assert.ok(!('raw_payload' in body.alarms[0]));
  const full = await get(t, 'admin', '/api/alarms?pageSize=10');
  const statuses = full.body.alarms.map(alarm => alarm.status);
  assert.deepEqual(statuses, ['active', 'active', 'active', 'resolved', 'resolved']);
  assert.ok(full.body.alarms[0].plant && full.body.alarms[0].device);
});

// 6/7/8/9. filtros
test('6/7/8/9: filtros status/severity/provider/device', async t => {
  assert.equal((await get(t, 'admin', '/api/alarms?status=resolved')).body.pagination.total, 2);
  assert.equal((await get(t, 'admin', '/api/alarms?severity=critical&status=active')).body.pagination.total, 1);
  assert.equal((await get(t, 'admin', '/api/alarms?provider=hyxi')).body.pagination.total, 2);
  assert.equal((await get(t, 'admin', `/api/alarms?deviceId=${D1}`)).body.pagination.total, 2);
  assert.equal((await get(t, 'admin', '/api/alarms?status=bogus')).status, 400);
  assert.equal((await get(t, 'admin', '/api/alarms?pageSize=1000')).status, 400);
});

// 10/11. fechas y search (plant name fuera del search)
test('10/11: fechas y search solo normalizado', async t => {
  const from = await get(t, 'admin', `/api/alarms?dateFrom=${encodeURIComponent('2026-10-01T00:00:00.000Z')}`);
  assert.equal(from.body.pagination.total, 3);
  const search = await get(t, 'admin', '/api/alarms?search=isolation');
  assert.equal(search.body.pagination.total, 1);
  const plantSearch = await get(t, 'admin', '/api/alarms?search=Planta%20B');
  assert.equal(plantSearch.body.pagination.total, 0);
});

// 16. detalle: formato malo 400, inexistente 404
test('16: detalle 400/404', async t => {
  assert.equal((await get(t, 'admin', '/api/alarms/no-uuid')).status, 400);
  assert.equal((await get(t, 'admin', '/api/alarms/99999999-9999-4999-8999-999999999999')).status, 404);
});

// 18. detalle con raw_payload
test('18: detalle incluye raw_payload', async t => {
  const { status, body } = await get(t, 'admin', `/api/alarms/${A2}`);
  assert.equal(status, 200);
  assert.deepEqual(body.raw_payload, { warnCode: 3 });
  assert.equal(body.alarm_code, 'WARN:3');
});

// 25. /summary no cae en /:id
test('25: summary responde KPIs, no 400/404 de id', async t => {
  const { status, body } = await get(t, 'admin', '/api/alarms/summary');
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body).sort(), ['active', 'by_provider', 'critical', 'resolved_7d', 'warning']);
  assert.equal(body.active, 3);
  assert.equal(body.critical, 1);
  assert.equal(body.warning, 1);
  assert.equal(body.resolved_7d, 1);
  assert.deepEqual(body.by_provider, { hyxi: 1, growatt: 2 });
});

// ---- Nivel controlador: scopes y sanitización ----
// 4. scope limita plantas
test('4: scope por plantas llega al repositorio', async () => {
  repoCalls.page.length = 0;
  const req = { scope: { plantIds: new Set([PA]) }, query: {} };
  const res = fakeRes();
  await controller.listAlarms(req, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.alarms.length > 0 && res.body.alarms.every(alarm => alarm.plant.id === PA));
  assert.deepEqual([...repoCalls.page.at(-1).plantIds], [PA]);
});

// 5. plantId fuera de scope → página vacía sin tocar repo
test('5: plantId fuera de scope no filtra nada', async () => {
  const before = repoCalls.page.length;
  const req = { scope: { plantIds: new Set([PA]) }, query: { plantId: PB } };
  const res = fakeRes();
  await controller.listAlarms(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.alarms, []);
  assert.equal(res.body.pagination.total, 0);
  assert.equal(repoCalls.page.length, before);
});

// 14/15/19. detalle válido, fuera de scope 404, secretos saneados sin tocar BD
test('14/15/19: detalle, scope y sanitización', async () => {
  const before = JSON.stringify(rows.find(row => row.id === A1).raw_payload);
  const ok = fakeRes();
  await controller.getAlarm({ scope: { plantIds: null }, params: { id: A1 } }, ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.raw_payload.auth.access_token, '[REDACTED]');
  assert.equal(ok.body.raw_payload.deep.list[0].password, '[REDACTED]');
  assert.equal(ok.body.raw_payload.api_key, '[REDACTED]');
  assert.equal(ok.body.raw_payload.ok, 1);
  assert.equal(JSON.stringify(rows.find(row => row.id === A1).raw_payload), before);
  const scoped = fakeRes();
  await controller.getAlarm({ scope: { plantIds: new Set([PB]) }, params: { id: A1 } }, scoped);
  assert.equal(scoped.statusCode, 404);
});

// 20-24. summary respeta scope
test('20-24: summary con y sin scope', async () => {
  const full = fakeRes();
  await controller.getSummary({ scope: { plantIds: null } }, full);
  assert.deepEqual(full.body, { active: 3, critical: 1, warning: 1, resolved_7d: 1, by_provider: { hyxi: 1, growatt: 2 } });
  const scopedRes = fakeRes();
  await controller.getSummary({ scope: { plantIds: new Set([PA]) } }, scopedRes);
  assert.deepEqual(scopedRes.body, { active: 3, critical: 1, warning: 1, resolved_7d: 0, by_provider: { hyxi: 1, growatt: 2 } });
  assert.deepEqual([...repoCalls.summary.at(-1).plantIds], [PA]);
});
