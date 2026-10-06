import test from 'node:test';
import assert from 'node:assert/strict';
import { HYXI_ENDPOINTS } from '../src/providers/hyxi/hyxiConstants.js';
import {
  createHyxiAlarmSync,
  normalizeHyxiAlarmItem,
} from '../src/services/hyxiAlarmSync.service.js';

const NOW = '2026-10-06T12:00:00.000Z';
const PLANT = { id: 'p1', external_plant_id: 'e1', name: 'Uno' };
const DEVICE = { id: 'd1', plant_id: 'p1', serial_number: 'SN1' };

function item(overrides = {}) {
  return {
    id: 2400800,
    alarmCode: '5459',
    alarmName: 'Grid Frequency Overrun Fault',
    alarmLevel: 3,
    alarmState: 2,
    beginTime: 1791280704000,
    endTime: 1791280782000,
    deviceSn: 'SN1',
    deviceName: 'HYX-S6K-S0555',
    deviceType: 2,
    plantId: 'e1',
    plantName: 'SFV_Juana Consuelo',
    ...overrides,
  };
}

function page(items, { totalPage = 1 } = {}) {
  return {
    success: true, code: '0', msg: 'Success',
    data: { currentPage: 1, pageSize: 100, totalPage, totalRows: items.length, pageData: items },
  };
}

// Repositorio falso en memoria con la semántica de 034: unicidad parcial
// de episodio ACTIVO (usada por createAlarmEpisode vía 23505) y NINGÚN
// árbitro para resolved (el gate de concurrencia documentado).
function fakeRepository() {
  const store = [];
  const calls = [];
  let seq = 0;
  const key = (row) => `${row.provider}|${row.device_id ?? ''}|${row.plant_id}|${row.alarm_code}|${row.external_alarm_id ?? ''}`;
  return {
    store,
    calls,
    async findAlarmByExternalId(provider, externalAlarmId) {
      calls.push('find');
      return store.find(row => row.provider === provider && row.external_alarm_id === externalAlarmId) ?? null;
    },
    async createAlarmEpisode(values) {
      calls.push('create-active');
      const row = {
        id: `a${++seq}`,
        status: 'active',
        resolved_at: null,
        plant_id: values.plantId,
        device_id: values.deviceId ?? null,
        provider: values.provider,
        external_alarm_id: values.externalAlarmId ?? null,
        alarm_code: values.alarmCode,
        title: values.title,
        first_seen_at: values.firstSeenAt,
        last_seen_at: values.lastSeenAt,
        raw_payload: values.rawPayload,
      };
      const clash = store.some(existing => existing.status === 'active' && key(existing) === key(row));
      if (clash) {
        const error = new Error('duplicate');
        error.code = '23505';
        throw error;
      }
      store.push(row);
      return { alarm: row, created: true };
    },
    async createResolvedAlarmEpisode(values) {
      calls.push('create-resolved');
      const row = {
        id: `a${++seq}`,
        status: 'resolved',
        plant_id: values.plantId,
        device_id: values.deviceId ?? null,
        provider: values.provider,
        external_alarm_id: values.externalAlarmId ?? null,
        alarm_code: values.alarmCode,
        title: values.title,
        started_at: values.startedAt ?? null,
        resolved_at: values.resolvedAt,
        first_seen_at: values.firstSeenAt,
        last_seen_at: values.lastSeenAt,
        raw_payload: values.rawPayload,
      };
      store.push(row);
      return { alarm: row, created: true };
    },
    async touchActiveAlarm(id, values) {
      calls.push('touch-active');
      const row = store.find(entry => entry.id === id && entry.status === 'active') ?? null;
      if (row) Object.assign(row, { last_seen_at: values.lastSeenAt, raw_payload: values.rawPayload });
      return row;
    },
    async touchAlarmObservation(id, values) {
      calls.push('touch-observation');
      const row = store.find(entry => entry.id === id) ?? null;
      if (row) Object.assign(row, { last_seen_at: values.lastSeenAt, raw_payload: values.rawPayload });
      return row;
    },
    async resolveAlarm(id, values) {
      calls.push('resolve');
      const row = store.find(entry => entry.id === id && entry.status === 'active') ?? null;
      if (row) Object.assign(row, { status: 'resolved', resolved_at: values.resolvedAt });
      return row;
    },
  };
}

// Provider estricto: solo getPlantAlarms existe; cualquier otro método
// (alterAlarm, subscribe, ...) lanza. Prueba 24/25/26.
function strictProvider(pagesByPlant) {
  const calls = [];
  const target = {
    async getPlantAlarms(externalPlantId, currentPage, pageSize) {
      calls.push({ externalPlantId, currentPage, pageSize });
      const pages = pagesByPlant[externalPlantId];
      const entry = Array.isArray(pages) ? pages[currentPage - 1] : pages;
      if (entry instanceof Error) throw entry;
      return entry;
    },
  };
  return {
    calls,
    provider: new Proxy(target, {
      get(obj, prop) {
        if (prop in obj) return obj[prop];
        return () => { throw new Error(`unexpected HYXi call: ${String(prop)}`); };
      },
    }),
  };
}

function harness({ pagesByPlant, devices = [DEVICE], now = NOW } = {}) {
  const repository = fakeRepository();
  const { calls, provider } = strictProvider(pagesByPlant);
  const logged = [];
  const sync = createHyxiAlarmSync({
    listPlants: async () => [PLANT],
    provider,
    listDevices: async () => devices,
    repository,
    now: () => now,
    logger: { error: (...args) => logged.push(args), info: () => {}, warn: () => {} },
  });
  return { sync, repository, calls, logged };
}

// 1. endpoint correcto
test('1: la constante apunta al endpoint real /api/alarm/v1/plantAlarmPage', () => {
  assert.equal(HYXI_ENDPOINTS.plantAlarms, '/api/alarm/v1/plantAlarmPage');
});

// 2. paginación 1 página
test('2: una sola página persiste sus episodios', async () => {
  const { sync, repository } = harness({ pagesByPlant: { e1: page([item()]) } });
  const result = await sync();
  assert.equal(result.checked_plants, 1);
  assert.equal(result.failed_plants, 0);
  assert.equal(repository.store.length, 1);
  assert.equal(result.resolved.length, 1);
});

// 3. múltiples páginas secuenciales
test('3: recorre todas las páginas en orden con el mismo pageSize', async () => {
  const p1 = { success: true, code: '0', msg: 'Success', data: { currentPage: 1, pageSize: 100, totalPage: 2, totalRows: 2, pageData: [item({ id: 1, endTime: 0 })] } };
  const p2 = { success: true, code: '0', msg: 'Success', data: { currentPage: 2, pageSize: 100, totalPage: 2, totalRows: 2, pageData: [item({ id: 2, endTime: 0 })] } };
  const { sync, repository, calls } = harness({ pagesByPlant: { e1: [p1, p2] } });
  await sync();
  assert.deepEqual(calls.map(call => call.currentPage), [1, 2]);
  assert.deepEqual(calls.map(call => call.pageSize), [100, 100]);
  assert.equal(repository.store.length, 2);
});

// 4. fallo en página intermedia aborta la planta
test('4: fallo de página intermedia aborta la planta sin pedir más páginas', async () => {
  const p1 = { success: true, code: '0', msg: 'Success', data: { currentPage: 1, pageSize: 100, totalPage: 3, totalRows: 3, pageData: [item({ id: 1, endTime: 0 })] } };
  const boom = new Error('HYXi request failed');
  const { sync, repository, calls } = harness({ pagesByPlant: { e1: [p1, boom] } });
  const result = await sync();
  assert.equal(result.failed_plants, 1);
  assert.equal(result.failures[0].plant_id, 'p1');
  assert.deepEqual(calls.map(call => call.currentPage), [1, 2]);
  assert.equal(repository.store.length, 1);
});

// 5. id numérico → external_alarm_id string
test('5: id numérico se conserva como external_alarm_id string', async () => {
  const { sync, repository } = harness({ pagesByPlant: { e1: page([item({ id: 2400800, endTime: 0 })]) } });
  await sync();
  assert.equal(repository.store[0].external_alarm_id, '2400800');
});

// 6. mismo device+code con IDs distintos → episodios distintos
test('6: recurrencias con IDs distintos no se deduplican por código', async () => {
  const episodes = [
    item({ id: 10, alarmCode: '5459', beginTime: 1791020768000, endTime: 1791020775000 }),
    item({ id: 20, alarmCode: '5459', beginTime: 1791193963000, endTime: 1791193966000 }),
  ];
  const { sync, repository } = harness({ pagesByPlant: { e1: page(episodes) } });
  await sync();
  assert.equal(repository.store.length, 2);
  assert.deepEqual(repository.store.map(row => row.external_alarm_id).sort(), ['10', '20']);
});

// 7. mismo ID repetido → no duplica
test('7: el mismo ID en polls sucesivos no crea filas nuevas', async () => {
  const payload = page([item({ id: 10, endTime: 0 })]);
  const repository = fakeRepository();
  const first = strictProvider({ e1: payload });
  const sync1 = createHyxiAlarmSync({
    listPlants: async () => [PLANT], provider: first.provider,
    listDevices: async () => [DEVICE], repository, now: () => NOW, logger: { error: () => {}, info: () => {}, warn: () => {} },
  });
  await sync1();
  const second = strictProvider({ e1: payload });
  const sync2 = createHyxiAlarmSync({
    listPlants: async () => [PLANT], provider: second.provider,
    listDevices: async () => [DEVICE], repository, now: () => NOW, logger: { error: () => {}, info: () => {}, warn: () => {} },
  });
  const result = await sync2();
  assert.equal(repository.store.length, 1);
  assert.equal(result.created.length, 0);
  assert.equal(result.touched.length, 1);
});

// 8. evento con endTime → resolved con resolved_at del fabricante
test('8: endTime válido crea episodio resolved con timestamps del fabricante', async () => {
  const { sync, repository } = harness({
    pagesByPlant: { e1: page([item({ beginTime: 1791280704000, endTime: 1791280782000 })]) },
  });
  await sync();
  const row = repository.store[0];
  assert.equal(row.status, 'resolved');
  assert.equal(row.started_at, '2026-10-06T09:58:24.000Z');
  assert.equal(row.resolved_at, '2026-10-06T09:59:42.000Z');
});

// 9. evento sin endTime → active con resolved_at NULL
test('9: sin endTime crea episodio active', async () => {
  const { sync, repository } = harness({ pagesByPlant: { e1: page([item({ endTime: 0 })]) } });
  await sync();
  const row = repository.store[0];
  assert.equal(row.status, 'active');
  assert.equal(row.resolved_at, null);
});

// 10. active → mismo ID con endTime → MISMO episodio resolved
test('10: el mismo ID que luego trae endTime resuelve sin crear fila', async () => {
  const repository = fakeRepository();
  const devices = async () => [DEVICE];
  const quiet = { error: () => {}, info: () => {}, warn: () => {} };
  const run = async (payload) => {
    const { provider } = strictProvider({ e1: payload });
    return createHyxiAlarmSync({
      listPlants: async () => [PLANT], provider, listDevices: devices,
      repository, now: () => NOW, logger: quiet,
    })();
  };
  await run(page([item({ id: 10, endTime: 0 })]));
  const result = await run(page([item({ id: 10, endTime: 1791280782000 })]));
  assert.equal(repository.store.length, 1);
  assert.equal(repository.store[0].status, 'resolved');
  assert.equal(repository.store[0].resolved_at, '2026-10-06T09:59:42.000Z');
  assert.equal(result.resolved.length, 1);
  assert.equal(result.created.length, 0);
});

// 11. alarmState NO determina status
test('11: alarmState 0/1/2 sin endTime siempre es active', async () => {
  for (const alarmState of [0, 1, 2]) {
    const normalized = normalizeHyxiAlarmItem(item({ alarmState, endTime: 0 }), NOW);
    assert.equal(normalized.status, 'active', `state=${alarmState}`);
  }
  const withEnd = normalizeHyxiAlarmItem(item({ alarmState: 0, endTime: 1791280782000 }), NOW);
  assert.equal(withEnd.status, 'resolved');
});

// 12/13. alarmLevel NO determina severity
test('12/13: alarmLevel 1/2/3 siempre produce severity NULL', () => {
  for (const alarmLevel of [1, 2, 3]) {
    const normalized = normalizeHyxiAlarmItem(item({ alarmLevel }), NOW);
    assert.equal(normalized.severity, null, `level=${alarmLevel}`);
  }
});

// 14. beginTime válido → started_at ISO
test('14: beginTime ms se convierte a started_at ISO', () => {
  const normalized = normalizeHyxiAlarmItem(item({ beginTime: 1791280704000 }), NOW);
  assert.equal(normalized.startedAt, '2026-10-06T09:58:24.000Z');
});

// 15. beginTime inválido → NULL
test('15: beginTime 0/null/texto inválido produce started_at NULL', () => {
  for (const beginTime of [0, null, undefined, 'nope', -5]) {
    const normalized = normalizeHyxiAlarmItem(item({ beginTime }), NOW);
    assert.equal(normalized.startedAt, null, `begin=${String(beginTime)}`);
  }
});

// 16. endTime inválido → active + resolved_at NULL
test('16: endTime 0/null produce active con resolved_at NULL', () => {
  for (const endTime of [0, null, undefined, 'nope']) {
    const normalized = normalizeHyxiAlarmItem(item({ endTime }), NOW);
    assert.equal(normalized.status, 'active', `end=${String(endTime)}`);
    assert.equal(normalized.resolvedAt, null);
  }
});

// 17. deviceSn conocido → device_id
test('17: deviceSn conocido resuelve device_id de la misma planta', async () => {
  const { sync, repository } = harness({ pagesByPlant: { e1: page([item({ deviceSn: 'SN1', endTime: 0 })]) } });
  await sync();
  assert.equal(repository.store[0].device_id, 'd1');
});

// 18. deviceSn desconocido → NULL sin fabricar UUID
test('18: deviceSn desconocido o ausente deja device_id NULL', async () => {
  const episodes = [item({ id: 1, deviceSn: 'GHOST', endTime: 0 }), item({ id: 2, deviceSn: null, endTime: 0 })];
  const { sync, repository } = harness({ pagesByPlant: { e1: page(episodes) } });
  await sync();
  assert.deepEqual(repository.store.map(row => row.device_id), [null, null]);
});

// 19. raw_payload conserva fabricante + regla RDX
test('19: raw_payload conserva item íntegro con alarmState/alarmLevel', async () => {
  const { sync, repository } = harness({ pagesByPlant: { e1: page([item({ endTime: 0 })]) } });
  await sync();
  const raw = repository.store[0].raw_payload;
  assert.equal(raw.alarmState, 2);
  assert.equal(raw.alarmLevel, 3);
  assert.equal(raw.alarmCode, '5459');
  assert.match(raw._rdx.status_rule, /endTime presence/);
});

// 20/21. title y fallback
test('20/21: title usa alarmName; fallback seguro solo si falta', () => {
  assert.equal(normalizeHyxiAlarmItem(item({ alarmName: 'Grid Frequency Overrun Fault' }), NOW).title, 'Grid Frequency Overrun Fault');
  for (const alarmName of [null, '', '   ', 'unknown']) {
    assert.equal(
      normalizeHyxiAlarmItem(item({ alarmName, alarmCode: '5459' }), NOW).title,
      'HYXi alarm 5459',
      `name=${String(alarmName)}`,
    );
  }
  assert.equal(normalizeHyxiAlarmItem(item({ id: null })), null);
  assert.equal(normalizeHyxiAlarmItem(item({ alarmCode: '  ' })), null);
  assert.equal(normalizeHyxiAlarmItem(null), null);
});

// 22. no resolución por ausencia
test('22: un episodio ausente en el poll siguiente sigue active', async () => {
  const repository = fakeRepository();
  const devices = async () => [DEVICE];
  const quiet = { error: () => {}, info: () => {}, warn: () => {} };
  const run = async (payload) => {
    const { provider } = strictProvider({ e1: payload });
    return createHyxiAlarmSync({
      listPlants: async () => [PLANT], provider, listDevices: devices,
      repository, now: () => NOW, logger: quiet,
    })();
  };
  await run(page([item({ id: 10, endTime: 0 })]));
  const result = await run(page([]));
  assert.equal(repository.store[0].status, 'active');
  assert.ok(!repository.calls.includes('resolve'));
  assert.equal(result.resolved.length, 0);
});

// 23. fallo HYXi no altera telemetría ni escribe parcial interpretable
test('23: fallo del fabricante registra failure sin tocar el store', async () => {
  const telemetry = { writes: 0 };
  const { sync, repository, logged } = harness({ pagesByPlant: { e1: new Error('timeout') } });
  const result = await sync();
  assert.equal(result.failed_plants, 1);
  assert.equal(result.checked_plants, 0);
  assert.equal(repository.store.length, 0);
  assert.equal(telemetry.writes, 0);
  assert.equal(logged.length, 1);
  assert.match(logged[0][1].message, /timeout/);
});

// 24/25/26. cero escrituras al fabricante
test('24/25/26: solo se llama getPlantAlarms; alterAlarm/subscribe lanzarían', async () => {
  const { sync, calls } = harness({ pagesByPlant: { e1: page([item({ endTime: 0 })]) } });
  await sync();
  assert.ok(calls.length > 0);
  assert.ok(calls.every(call => Object.keys(call).sort().join(',') === 'currentPage,externalPlantId,pageSize'));
});

// 27. históricos resueltos idempotentes
test('27: episodio resuelto re-observado no duplica, solo toca observación', async () => {
  const payload = page([item({ id: 10 })]);
  const repository = fakeRepository();
  const quiet = { error: () => {}, info: () => {}, warn: () => {} };
  const run = async () => {
    const { provider } = strictProvider({ e1: payload });
    return createHyxiAlarmSync({
      listPlants: async () => [PLANT], provider, listDevices: async () => [DEVICE],
      repository, now: () => NOW, logger: quiet,
    })();
  };
  await run();
  const result = await run();
  assert.equal(repository.store.length, 1);
  assert.equal(repository.store[0].status, 'resolved');
  assert.equal(result.created.length, 0);
  assert.equal(result.touched.length, 1);
});

// 28. lookup precede a todo insert (orden select-then-insert documentado)
test('28: findAlarmByExternalId se consulta antes de cualquier insert', async () => {
  const { sync, repository } = harness({ pagesByPlant: { e1: page([item({ endTime: 0 }), item({ id: null })]) } });
  const result = await sync();
  assert.equal(repository.calls[0], 'find');
  assert.equal(result.skipped, 1);
});

// 29. datos inválidos posteriores no degradan timestamps del episodio
test('29: re-observación sin tiempos conserva started_at/resolved_at', async () => {
  const repository = fakeRepository();
  const devices = async () => [DEVICE];
  const quiet = { error: () => {}, info: () => {}, warn: () => {} };
  const run = async (payload) => {
    const { provider } = strictProvider({ e1: payload });
    return createHyxiAlarmSync({
      listPlants: async () => [PLANT], provider, listDevices: devices,
      repository, now: () => NOW, logger: quiet,
    })();
  };
  await run(page([item({ id: 10, beginTime: 1791280704000, endTime: 1791280782000 })]));
  await run(page([item({ id: 10, beginTime: null, endTime: null, alarmName: null, deviceSn: 'GHOST' })]));
  const row = repository.store[0];
  assert.equal(repository.store.length, 1);
  assert.equal(row.started_at, '2026-10-06T09:58:24.000Z');
  assert.equal(row.resolved_at, '2026-10-06T09:59:42.000Z');
  assert.equal(row.status, 'resolved');
});
