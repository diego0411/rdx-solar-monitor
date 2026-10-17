import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Transporte simulado con el proveedor real; sin credenciales ni BD.
const env = {
  GROWATT_BASE_URL: 'https://growatt-a.invalid',
  GROWATT_API_TOKEN: 'secret-token-test',
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
let upsertThrow = null;
mock.module('../src/repositories/devices.repository.js', {
  exports: {
    async listActiveGrowattDevices() { return devices; },
    async updateGrowattDeviceName() { throw new Error('Unexpected name update'); },
    async updateGrowattDeviceTelemetryState() {},
  },
});
mock.module('../src/repositories/deviceLatestData.repository.js', {
  exports: {
    async upsertGrowattLatestData() {
      if (upsertThrow) upsertThrow();
    },
  },
});
mock.module('../src/services/growattAlarmSync.service.js', {
  exports: { async syncGrowattAlarmSnapshot() {} },
});
const { syncGrowattLatest } = await import('../src/services/growattLatest.service.js');

function interceptError(t) {
  const calls = [];
  t.mock.method(console, 'error', (...args) => { calls.push(args); });
  return calls;
}

function device(id, serial, type = 'MIN') {
  return { id, serial_number: serial, device_type: type, name: null, plant_id: 'p1', plant: { timezone: 'America/La_Paz' } };
}

function okReply(serials) {
  const rows = serials.map(serialNum => ({
    serialNum, status: 1, lost: false, time: '2026-09-27 10:00:00',
    ppv: 20, pac: 17, eacToday: 5, eacTotal: 50,
  }));
  return {
    ok: true,
    async json() { return { code: 0, data: { MIN: rows } }; },
  };
}

test('batch HTTP failure logs stage, category y mensaje sanitizado; contadores intactos', async t => {
  devices = [device('d1', 'SN1'), device('d2', 'SN2')];
  upsertThrow = null;
  const calls = interceptError(t);
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false,
    status: 502,
    async json() { return {}; },
  }));

  const result = await syncGrowattLatest(1_700_000_000_000);
  assert.equal(result.processed, 2);
  assert.equal(result.failed, 2);
  assert.equal(result.updated, 0);
  assert.equal(result.rate_limited, false);
  assert.equal(result.permission_denied, false);

  const batchLog = calls.find(([msg]) => msg === 'Growatt latest sync batch failed:');
  assert.ok(batchLog, 'debe registrar el fallo de lote');
  const entry = batchLog[1];
  assert.equal(entry.stage, 'batch');
  assert.equal(entry.device_type, 'MIN');
  assert.equal(entry.batch_size, 2);
  assert.equal(entry.category, 'error');
  assert.equal(entry.status_code, null);
  assert.match(entry.message, /Growatt latest data request failed/);
  const serialized = JSON.stringify(calls);
  assert.ok(!serialized.includes('secret-token-test'), 'sin token en logs');
  assert.equal(calls.filter(([msg]) => msg === 'Growatt latest sync device errors:').length, 0);
});

test('device failures equivalentes se agregan en UNA línea con count', async t => {
  devices = [device('d1', 'SN1'), device('d2', 'SN2'), device('d3', 'SN3')];
  upsertThrow = () => {
    throw new Error('No se pudo guardar la telemetría Growatt: relation unavailable');
  };
  const calls = interceptError(t);
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const serials = options.body.get('deviceSn').split(',');
    return okReply(serials);
  });

  const result = await syncGrowattLatest(1_700_000_000_000);
  assert.equal(result.processed, 3);
  assert.equal(result.failed, 3);
  assert.equal(result.updated, 0);

  const deviceLogs = calls.filter(([msg]) => msg === 'Growatt latest sync device errors:');
  assert.equal(deviceLogs.length, 1, 'una sola línea agregada');
  const entries = deviceLogs[0][1];
  assert.equal(entries.length, 1);
  assert.equal(entries[0].stage, 'device');
  assert.equal(entries[0].category, 'error');
  assert.equal(entries[0].count, 3);
  assert.match(entries[0].message, /No se pudo guardar la telemetría Growatt/);
  const serialized = JSON.stringify(calls);
  assert.ok(!serialized.includes('secret-token-test'), 'sin token en logs');
  assert.equal(calls.filter(([msg]) => msg === 'Growatt latest sync batch failed:').length, 0);
});

test('errores de dispositivo distintos se agregan por clave separada', async t => {
  devices = [device('d1', 'SN1'), device('d2', 'SN2')];
  let call = 0;
  upsertThrow = () => {
    call += 1;
    if (call === 1) throw new Error('boom-alpha');
    const err = new Error('boom-beta');
    err.statusCode = 500;
    throw err;
  };
  const calls = interceptError(t);
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const serials = options.body.get('deviceSn').split(',');
    return okReply(serials);
  });

  const result = await syncGrowattLatest(1_700_000_000_000);
  assert.equal(result.failed, 2);

  const deviceLogs = calls.filter(([msg]) => msg === 'Growatt latest sync device errors:');
  assert.equal(deviceLogs.length, 1);
  const entries = deviceLogs[0][1];
  assert.equal(entries.length, 2);
  assert.equal(entries.find(e => e.message === 'boom-alpha').count, 1);
  const beta = entries.find(e => e.message === 'boom-beta');
  assert.equal(beta.count, 1);
  assert.equal(beta.status_code, 500);
});
