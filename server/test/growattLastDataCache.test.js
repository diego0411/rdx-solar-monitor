import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Provider y consumidor reales; solo transporte, configuración y persistencia
// simulados. No se cargan credenciales, cachés de disco ni se escribe en BD.
const env = {
  GROWATT_BASE_URL: 'https://growatt-a.invalid',
  GROWATT_API_TOKEN: 'aud02-test',
  GROWATT_TOKEN_ENCRYPTION_KEY: '',
};
mock.module('../src/config/env.js', { exports: { env } });
mock.module('node:fs', {
  exports: {
    existsSync: () => false,
    readFileSync() { throw new Error('Unexpected disk read'); },
    mkdirSync() { throw new Error('Unexpected disk write'); },
    writeFileSync() { throw new Error('Unexpected disk write'); },
  },
});

let devices = [];
let latestWrites = [];
let stateWrites = [];
mock.module('../src/repositories/devices.repository.js', {
  exports: {
    async listActiveGrowattDevices() { return devices; },
    async updateGrowattDeviceName() { throw new Error('Unexpected name update'); },
    async updateGrowattDeviceTelemetryState(id, status, collectedAt) {
      stateWrites.push({ id, status, collectedAt });
    },
  },
});
mock.module('../src/repositories/deviceLatestData.repository.js', {
  exports: {
    async upsertGrowattLatestData(row) { latestWrites.push(row); },
  },
});
mock.module('../src/services/growattAlarmSync.service.js', {
  exports: { async syncGrowattAlarmSnapshot() {} },
});
const { GrowattProvider } = await import('../src/providers/growatt/GrowattProvider.js');
const { syncGrowattLatest } = await import('../src/services/growattLatest.service.js');

function transport(t) {
  const calls = [];
  const state = { reply: null };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = options.body;
    const request = {
      url: String(url), token: options.headers.token,
      type: body.get('deviceType'), serials: body.get('deviceSn').split(','),
      options,
    };
    calls.push(request);
    if (state.reply) return state.reply(request);
    const rows = request.serials.map(serialNum => ({
      serialNum, status: 1, lost: false, time: '2026-09-27 10:00:00',
      ppv: 20, pac: 17, eacToday: 5, eacTotal: 50,
      pacToLocalLoad: 0, pacToUserTotal: null, pacToGridTotal: 17,
    }));
    return {
      ok: true,
      async json() { return { code: 0, data: { [request.type]: rows }, origin: new URL(url).origin }; },
    };
  });
  return { calls, state };
}

test('AUD-02: lote idéntico reutiliza respuesta entre instancias y conserva el request', async t => {
  const { calls } = transport(t);
  const first = await new GrowattProvider().queryLastData('MIN', ['A', 'B'], 'same-batch');
  const second = await new GrowattProvider().queryLastData('MIN', ['A', 'B'], 'same-batch');
  assert.strictEqual(second.payload, first.payload);
  assert.equal(second.rateLimited, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://growatt-a.invalid/v4/new-api/queryLastData');
  assert.equal(calls[0].token, 'same-batch');
  assert.deepEqual(calls[0].serials, ['A', 'B']);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test('AUD-02: lotes distintos con mismo tipo y token nunca comparten respuesta', async t => {
  const { calls } = transport(t);
  const provider = new GrowattProvider();
  const first = await provider.queryLastData('MIN', ['A', 'B'], 'different-batches');
  const second = await provider.queryLastData('MIN', ['C'], 'different-batches');
  assert.deepEqual(first.payload.data.MIN.map(row => row.serialNum), ['A', 'B']);
  assert.deepEqual(second.payload.data.MIN.map(row => row.serialNum), ['C']);
  assert.equal(calls.length, 2);
});

test('AUD-02: subconjunto de un lote requiere su propia respuesta', async t => {
  const { calls } = transport(t);
  const provider = new GrowattProvider();
  await provider.queryLastData('MIN', ['A', 'B'], 'subset');
  const response = await provider.queryLastData('MIN', ['A'], 'subset');
  assert.deepEqual(response.payload.data.MIN.map(row => row.serialNum), ['A']);
  assert.equal(calls.length, 2);
});

test('AUD-02: la misma consulta en bases distintas queda aislada', async t => {
  const { calls } = transport(t);
  const firstProvider = new GrowattProvider();
  const secondProvider = new GrowattProvider();
  secondProvider.baseUrl = 'https://growatt-b.invalid';
  const first = await firstProvider.queryLastData('MIN', ['A'], 'base-context');
  const second = await secondProvider.queryLastData('MIN', ['A'], 'base-context');
  assert.equal(first.payload.origin, 'https://growatt-a.invalid');
  assert.equal(second.payload.origin, 'https://growatt-b.invalid');
  assert.equal(calls.length, 2);
});

test('AUD-02: URL efectiva equivalente conserva la reutilización', async t => {
  const { calls } = transport(t);
  const provider = new GrowattProvider();
  const first = await provider.queryLastData('MIN', ['A'], 'equivalent-base');
  provider.baseUrl = 'https://growatt-a.invalid/';
  const second = await provider.queryLastData('MIN', ['A'], 'equivalent-base');
  assert.strictEqual(second.payload, first.payload);
  assert.equal(calls.length, 1);
});

test('AUD-02: tokens de cuentas distintas quedan aislados', async t => {
  const { calls } = transport(t);
  const provider = new GrowattProvider();
  const first = await provider.queryLastData('MIN', ['A'], 'account-a');
  const second = await provider.queryLastData('MIN', ['A'], 'account-b');
  assert.notStrictEqual(second.payload, first.payload);
  assert.deepEqual(calls.map(call => call.token), ['account-a', 'account-b']);
});

test('AUD-02: tipos distintos quedan aislados', async t => {
  const { calls } = transport(t);
  const provider = new GrowattProvider();
  await provider.queryLastData('MIN', ['A'], 'type-context');
  const response = await provider.queryLastData('TLX', ['A'], 'type-context');
  assert.deepEqual(response.payload.data.TLX.map(row => row.serialNum), ['A']);
  assert.deepEqual(calls.map(call => call.type), ['MIN', 'TLX']);
});

test('AUD-02: TTL y fallback 102 solo reutilizan el lote exacto', async t => {
  const { calls, state } = transport(t);
  let now = 1000000;
  t.mock.method(Date, 'now', () => now);
  const provider = new GrowattProvider();
  const first = await provider.queryLastData('MIN', ['A'], 'throttled');
  now += 300001;
  state.reply = () => ({ ok: true, async json() { return { code: 102 }; } });
  await assert.rejects(provider.queryLastData('MIN', ['B'], 'throttled'), error =>
    error.rateLimited === true && error.statusCode === 429);
  const fallback = await provider.queryLastData('MIN', ['A'], 'throttled');
  assert.strictEqual(fallback.payload, first.payload);
  assert.equal(fallback.rateLimited, true);
  assert.equal(calls.length, 3);
});

test('AUD-02: caché vencida refresca el mismo lote', async t => {
  const { calls } = transport(t);
  let now = 2000000;
  t.mock.method(Date, 'now', () => now);
  const provider = new GrowattProvider();
  const first = await provider.queryLastData('MIN', ['A'], 'expiry');
  now += 300001;
  const refreshed = await provider.queryLastData('MIN', ['A'], 'expiry');
  assert.notStrictEqual(refreshed.payload, first.payload);
  assert.equal(refreshed.rateLimited, false);
  assert.equal(calls.length, 2);
});

test('AUD-02: PERMISSION_DENIED se conserva y no cachea el fallo', async t => {
  const { calls, state } = transport(t);
  state.reply = () => ({ ok: true, async json() { return { code: 101, message: 'PERMISSION_DENIED' }; } });
  const provider = new GrowattProvider();
  await assert.rejects(provider.queryLastData('MIN', ['A'], 'permission'), error =>
    error.permissionDenied === true && error.statusCode === 403);
  state.reply = null;
  const response = await provider.queryLastData('MIN', ['A'], 'permission');
  assert.deepEqual(response.payload.data.MIN.map(row => row.serialNum), ['A']);
  assert.equal(calls.length, 2);
});

for (const [count, batchSizes] of [[100, [100]], [101, [100, 1]], [201, [100, 100, 1]]]) {
  test(`AUD-02: sync real de ${count} dispositivos procesa todos los lotes y los reutiliza`, async t => {
    const { calls } = transport(t);
    env.GROWATT_API_TOKEN = `fleet-${count}`;
    devices = Array.from({ length: count }, (_, index) => ({
      id: `device-${index}`, serial_number: `SN${index}`, device_type: 'MIN',
      name: 'Inversor', active: true, plant: { timezone: 'GMT-4' },
    }));
    latestWrites = [];
    stateWrites = [];
    const now = Date.parse('2026-09-27T14:00:00Z');
    for (let pass = 0; pass < 2; pass++) {
      const result = await syncGrowattLatest(now);
      assert.equal(result.processed, count);
      assert.equal(result.updated, count);
      assert.equal(result.no_data, 0);
      assert.equal(result.failed, 0);
      assert.equal(result.rate_limited, false);
      assert.equal(result.permission_denied, false);
      assert.deepEqual(result.errors, []);
    }
    assert.deepEqual(calls.map(call => call.serials.length), batchSizes);
    assert.equal(latestWrites.length, count * 2);
    assert.equal(stateWrites.length, count * 2);
    for (let index = 0; index < count; index++) {
      const row = latestWrites[index];
      assert.equal(row.device_id, `device-${index}`);
      assert.equal(row.raw_data.serialNum, `SN${index}`);
      assert.equal(row.provider, 'growatt');
      assert.equal(row.ac_power, 17);
      assert.equal(row.load_power, 0);
      assert.equal(row.grid_import_power, null);
      assert.equal(row.device_status, 'online');
      assert.deepEqual(stateWrites[index], {
        id: `device-${index}`, status: 'online', collectedAt: '2026-09-27T14:00:00.000Z',
      });
    }
  });
}
