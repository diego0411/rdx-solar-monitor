import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alarmTimestamp, createHyxiRecentAlarmsService, extractAlarmItems,
} from '../src/services/hyxiRecentAlarms.service.js';
import { hyxiClient } from '../src/providers/hyxi/hyxiClient.js';

test('extrae el arreglo real sin renombrar campos y reconoce fechas presentes', () => {
  const alarms = [{ alarmCode: 'A1', alarmTime: '2026-09-15T10:00:00Z' }];
  assert.equal(extractAlarmItems({ data: { arbitraryProviderKey: alarms } }), alarms);
  assert.equal(alarmTimestamp(alarms[0]), Date.parse('2026-09-15T10:00:00Z'));
});

test('agrega secuencialmente, ordena, limita y reutiliza cache durante cinco minutos', async () => {
  const plants = [
    { id: 'p1', external_plant_id: 'e1', name: 'Uno' },
    { id: 'p2', external_plant_id: 'e2', name: 'Dos' },
    { id: 'p3', external_plant_id: 'e3', name: 'Tres' },
  ];
  const calls = [];
  const provider = {
    async getPlantAlarms(id, page, pageSize) {
      calls.push({ id, page, pageSize });
      if (id === 'e3') throw new Error('rate limit');
      return { data: { items: [{ code: id, eventTime: id === 'e1' ? 1000 : 2000 }] } };
    },
  };
  let clock = Date.parse('2026-09-15T12:00:00Z');
  const getRecent = createHyxiRecentAlarmsService({
    listPlants: async () => plants, provider, now: () => clock,
  });

  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  const first = await getRecent();
  const cached = await getRecent();
  console.error = originalConsoleError;
  assert.equal(cached, first);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(call => call.pageSize), [20, 20, 20]);
  assert.equal(first.partial, true);
  assert.equal(first.checked_plants, 3);
  assert.equal(first.failed_plants, 1);
  assert.deepEqual(first.alarms.map(item => item.plant.id), ['p2', 'p1']);
  assert.equal(first.alarms[0].alarm.code, 'e2');
  assert.equal(logged.length, 1);
  assert.deepEqual(logged[0][1], {
    plant_id: 'p3', external_plant_id: 'e3', plant_name: 'Tres',
    http_status: null, provider_code: null, message: 'rate limit',
  });

  clock += 5 * 60 * 1000;
  console.error = () => {};
  await getRecent();
  console.error = originalConsoleError;
  assert.equal(calls.length, 6);
});

test('comparte el llenado de cache entre consultas simultaneas', async () => {
  let calls = 0;
  const getRecent = createHyxiRecentAlarmsService({
    listPlants: async () => [{ id: 'p1', external_plant_id: 'e1', name: 'Uno' }],
    provider: { async getPlantAlarms() { calls += 1; return { data: [] }; } },
  });
  const [first, second] = await Promise.all([getRecent(), getRecent()]);
  assert.equal(calls, 1);
  assert.equal(first, second);
});

test('hyxiClient conserva status, codigo y mensaje sin exponer la solicitud', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    if (fetchCalls === 1) return {
      ok: true,
      status: 200,
      async json() {
        return { success: true, code: '0', data: { access_token: 'mock-token', expires_in: 3600 } };
      },
    };
    return {
      ok: false,
      status: 429,
      async json() { return { success: false, code: 'RATE_LIMIT', msg: 'Too many requests' }; },
    };
  };
  try {
    await assert.rejects(() => hyxiClient.post('/test', {}), error => {
      assert.equal(error.message, 'HYXi request failed');
      assert.equal(error.httpStatus, 429);
      assert.equal(error.providerCode, 'RATE_LIMIT');
      assert.equal(error.providerMsg, 'Too many requests');
      return true;
    });
    assert.equal(fetchCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
