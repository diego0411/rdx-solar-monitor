import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Fake en memoria que replica la semántica de 034_alarms.sql + 035:
// identidad de episodio ACTIVO (device o planta) con
// COALESCE(external,'') y unicidad (provider, external_alarm_id) para
// external no-null en CUALQUIER estado (035). Sin UUID mágicos. La BD
// real aplica lo mismo vía índices parciales.
const store = [];
let seq = 0;
// Ganchos de prueba: simulan respuestas del INSERT sin tocar el store.
const forcedInsertErrors = new Map();

function identityKey(row) {
  const ext = row.external_alarm_id ?? '';
  if (row.device_id) return `D|${row.provider}|${row.device_id}|${row.alarm_code}|${ext}`;
  return `P|${row.provider}|${row.plant_id}|${row.alarm_code}|${ext}`;
}

function matches(row, filters) {
  return filters.every(filter => {
    if (filter.type === 'eq') return row[filter.col] === filter.val;
    if (filter.type === 'is') return filter.val === null ? row[filter.col] == null : row[filter.col] === filter.val;
    if (filter.type === 'in') return filter.val.includes(row[filter.col]);
    return true;
  });
}

class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.orders = [];
    this.slice = null;
    this.pendingInsert = null;
    this.pendingUpdate = null;
  }
  select() { return this; }
  eq(col, val) { this.filters.push({ type: 'eq', col, val }); return this; }
  is(col, val) { this.filters.push({ type: 'is', col, val }); return this; }
  in(col, val) { this.filters.push({ type: 'in', col, val }); return this; }
  order(col, { ascending }) { this.orders.push({ col, ascending }); return this; }
  range(from, to) { this.slice = [from, to]; return this; }
  insert(values) { this.pendingInsert = values; return this; }
  update(values) { this.pendingUpdate = values; return this; }
  run(mode) {
    if (this.pendingInsert) {
      const row = { id: `a${++seq}`, created_at: '2026-01-01T00:00:00.000Z', ...this.pendingInsert };
      const forced = forcedInsertErrors.get(row.external_alarm_id);
      if (forced) return { data: null, error: { code: forced, message: 'forced insert error' } };
      const clash = store.some(existing => existing.status === 'active' && identityKey(existing) === identityKey(row));
      const clashExternal = row.external_alarm_id != null && store.some(existing =>
        existing.provider === row.provider && existing.external_alarm_id === row.external_alarm_id);
      if (clash || clashExternal) return { data: null, error: { code: '23505', message: 'duplicate episode' } };
      store.push(row);
      return mode === 'single' && !row ? { data: null, error: { message: 'empty' } } : { data: row, error: null };
    }
    let rows = store.filter(row => matches(row, this.filters));
    if (this.pendingUpdate) {
      for (const row of rows) Object.assign(row, this.pendingUpdate);
    }
    for (const { col, ascending } of this.orders) {
      rows = [...rows].sort((a, b) => {
        if (a[col] === b[col]) return 0;
        if (a[col] == null) return 1;
        if (b[col] == null) return -1;
        return ascending ? (a[col] < b[col] ? -1 : 1) : (a[col] > b[col] ? -1 : 1);
      });
    }
    if (this.slice) rows = rows.slice(this.slice[0], this.slice[1] + 1);
    if (mode === 'single') {
      if (rows.length !== 1) return { data: null, error: { message: 'single row expected' } };
      return { data: rows[0], error: null };
    }
    if (mode === 'maybeSingle') return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }
  single() { return Promise.resolve(this.run('single')); }
  maybeSingle() { return Promise.resolve(this.run('maybeSingle')); }
  then(resolve, reject) { return Promise.resolve(this.run('many')).then(resolve, reject); }
}

const supabase = { from: () => new Query() };

mock.module('../src/config/supabase.js', { namedExports: { supabase } });
const repository = await import('../src/repositories/alarms.repository.js');

const PLANT = '11111111-1111-4111-8111-111111111111';
const PLANT2 = '22222222-2222-4222-8222-222222222222';
const MIN = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const MIN2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const T0 = '2026-10-06T10:00:00.000Z';
const T1 = '2026-10-06T10:20:00.000Z';
const T2 = '2026-10-06T15:00:00.000Z';

function growattAlarm(overrides = {}) {
  return {
    plantId: PLANT, deviceId: MIN, provider: 'growatt',
    alarmCode: 'faultType:5', title: 'Falla 5',
    firstSeenAt: T0, lastSeenAt: T0, ...overrides,
  };
}

// 1. crear alarma activa Growatt
test('1: crea episodio activo Growatt', async () => {
  const { alarm, created } = await repository.createAlarmEpisode(growattAlarm());
  assert.equal(created, true);
  assert.equal(alarm.status, 'active');
  assert.equal(alarm.resolved_at, null);
  assert.equal(alarm.plant_id, PLANT);
  assert.equal(alarm.first_seen_at, T0);
});

// 2. segundo intento misma alarma activa → no duplica
test('2: duplicado activo devuelve el episodio existente', async () => {
  const first = await repository.findActiveAlarm({ provider: 'growatt', deviceId: MIN, plantId: PLANT, alarmCode: 'faultType:5' });
  const { alarm, created } = await repository.createAlarmEpisode(growattAlarm({ lastSeenAt: T1 }));
  assert.equal(created, false);
  assert.equal(alarm.id, first.id);
  assert.equal(store.length, 1);
});

// 3. touch actualiza last_seen_at/raw_payload
test('3: touch actualiza last_seen_at y raw_payload del activo', async () => {
  const active = await repository.findActiveAlarm({ provider: 'growatt', deviceId: MIN, plantId: PLANT, alarmCode: 'faultType:5' });
  const touched = await repository.touchActiveAlarm(active.id, { lastSeenAt: T1, rawPayload: { faultType: 5 } });
  assert.equal(touched.last_seen_at, T1);
  assert.deepEqual(touched.raw_payload, { faultType: 5 });
});

// 4. resolver → resolved + resolved_at
test('4: resolve cierra el episodio y ya no es tocable', async () => {
  const active = await repository.findActiveAlarm({ provider: 'growatt', deviceId: MIN, plantId: PLANT, alarmCode: 'faultType:5' });
  const resolved = await repository.resolveAlarm(active.id, { resolvedAt: T1 });
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.resolved_at, T1);
  assert.equal(await repository.findActiveAlarm({ provider: 'growatt', deviceId: MIN, plantId: PLANT, alarmCode: 'faultType:5' }), null);
  assert.equal(await repository.touchActiveAlarm(active.id, {}), null);
  assert.equal(await repository.resolveAlarm(active.id, {}), null);
});

// 5. misma falla reaparece → NUEVO episodio
test('5: la falla reaparecida crea un episodio nuevo', async () => {
  const before = (await repository.listAlarms({})).length;
  const { alarm, created } = await repository.createAlarmEpisode(growattAlarm({ firstSeenAt: T2, lastSeenAt: T2 }));
  assert.equal(created, true);
  assert.equal((await repository.listAlarms({})).length, before + 1);
  assert.equal(alarm.first_seen_at, T2);
});

// 6. dos códigos diferentes mismo dispositivo → dos activas
test('6: códigos distintos conviven como activos', async () => {
  await repository.createAlarmEpisode(growattAlarm({ alarmCode: 'warnCode:8', title: 'Aviso 8' }));
  const actives = await repository.listAlarms({ status: 'active', deviceId: MIN });
  assert.equal(actives.length, 2);
});

// 7. mismo código en dispositivos diferentes → dos activas
test('7: mismo código en otro dispositivo es otro episodio', async () => {
  const { created } = await repository.createAlarmEpisode(growattAlarm({ deviceId: MIN2 }));
  assert.equal(created, true);
});

// 8. external_alarm_id nullable y parte de la identidad
test('8: external_alarm_id NULL y con valor son identidades distintas', async () => {
  const { created } = await repository.createAlarmEpisode(
    growattAlarm({ deviceId: MIN2, alarmCode: 'warnCode:8', externalAlarmId: 'EXT-1', title: 'Aviso 8 ext' }),
  );
  assert.equal(created, true);
  const dup = await repository.createAlarmEpisode(
    growattAlarm({ deviceId: MIN2, alarmCode: 'warnCode:8', externalAlarmId: 'EXT-1', title: 'Aviso 8 ext' }),
  );
  assert.equal(dup.created, false);
  assert.equal(dup.alarm.id, (await repository.findActiveAlarm({ provider: 'growatt', deviceId: MIN2, plantId: PLANT, alarmCode: 'warnCode:8', externalAlarmId: 'EXT-1' })).id);
  const plainCreated = await repository.createAlarmEpisode(
    growattAlarm({ deviceId: MIN2, alarmCode: 'warnCode:8', title: 'Aviso 8' }),
  );
  assert.equal(plainCreated.created, true);
  const plain = await repository.findActiveAlarm({ provider: 'growatt', deviceId: MIN2, plantId: PLANT, alarmCode: 'warnCode:8' });
  assert.equal(plain.external_alarm_id, null);
});

// 9/10. started_at y severity nullables
test('9/10: started_at y severity aceptan NULL y valores', async () => {
  const { alarm } = await repository.createAlarmEpisode(
    growattAlarm({ deviceId: MIN2, alarmCode: 'faultType:9', title: 'Falla 9', startedAt: T0, severity: 'critical', description: 'Detalle' }),
  );
  assert.equal(alarm.started_at, T0);
  assert.equal(alarm.severity, 'critical');
  assert.equal(alarm.description, 'Detalle');
  const plain = await repository.createAlarmEpisode(
    growattAlarm({ deviceId: MIN2, alarmCode: 'faultType:10', title: 'Falla 10' }),
  );
  assert.equal(plain.alarm.started_at, null);
  assert.equal(plain.alarm.severity, null);
});

// 11. invariante last_seen_at >= first_seen_at
test('11: rechaza last_seen_at anterior a first_seen_at', async () => {
  await assert.rejects(
    repository.createAlarmEpisode(growattAlarm({ alarmCode: 'faultType:11', title: 'Falla 11', firstSeenAt: T1, lastSeenAt: T0 })),
    /last_seen_at/,
  );
});

// 12. filtros listAlarms
test('12: listAlarms filtra por status/provider/scope/límite', async () => {
  const actives = await repository.listAlarms({ status: 'active' });
  assert.ok(actives.every(row => row.status === 'active'));
  const growatt = await repository.listAlarms({ provider: 'growatt' });
  assert.ok(growatt.length > 0 && growatt.every(row => row.provider === 'growatt'));
  assert.deepEqual(await repository.listAlarms({ plantIds: new Set() }), []);
  assert.deepEqual(await repository.listAlarms({ plantIds: new Set(['00000000-0000-0000-0000-000000000000']) }), []);
  const scoped = await repository.listAlarms({ plantIds: new Set([PLANT]) });
  assert.ok(scoped.length > 0 && scoped.every(row => row.plant_id === PLANT));
  const one = await repository.listAlarms({ limit: 1 });
  assert.equal(one.length, 1);
});

// 13. getAlarmById
test('13: getAlarmById devuelve la fila, null si no existe o fuera de scope', async () => {
  const any = (await repository.listAlarms({ limit: 1 }))[0];
  assert.equal((await repository.getAlarmById(any.id)).id, any.id);
  assert.equal(await repository.getAlarmById('no-existe'), null);
  assert.equal(await repository.getAlarmById(any.id, new Set([PLANT2])), null);
  assert.equal(await repository.getAlarmById(any.id, new Set()), null);
});

// 14. plant_id requerido
test('14: crear sin plant_id falla', async () => {
  await assert.rejects(repository.createAlarmEpisode(growattAlarm({ plantId: null })), /plant_id/);
});

// 15. device_id nullable para alarma a nivel planta
test('15: alarma a nivel planta sin device convive y se deduplica', async () => {
  const first = await repository.createAlarmEpisode({
    plantId: PLANT2, deviceId: null, provider: 'hyxi',
    alarmCode: 'plant-offline', title: 'Planta sin datos',
  });
  assert.equal(first.created, true);
  assert.equal(first.alarm.device_id, null);
  const dup = await repository.createAlarmEpisode({
    plantId: PLANT2, deviceId: null, provider: 'hyxi',
    alarmCode: 'plant-offline', title: 'Planta sin datos',
  });
  assert.equal(dup.created, false);
  assert.equal(dup.alarm.id, first.alarm.id);
  const found = await repository.findActiveAlarm({ provider: 'hyxi', plantId: PLANT2, alarmCode: 'plant-offline' });
  assert.equal(found.id, first.alarm.id);
});

// 16. resolved insert normal (HYXi primer poll con endTime)
test('16: createResolvedAlarmEpisode crea episodio resolved con resolved_at', async () => {
  const { alarm, created } = await repository.createResolvedAlarmEpisode({
    plantId: PLANT, deviceId: MIN, provider: 'hyxi', externalAlarmId: '2400800',
    alarmCode: '5459', title: 'Grid Frequency Overrun Fault',
    startedAt: T0, resolvedAt: T1, firstSeenAt: T1, lastSeenAt: T1,
    rawPayload: { id: 2400800 },
  });
  assert.equal(created, true);
  assert.equal(alarm.status, 'resolved');
  assert.equal(alarm.resolved_at, T1);
  assert.equal(alarm.started_at, T0);
  assert.equal(alarm.external_alarm_id, '2400800');
});

// 17. resolved insert 23505 → relectura del existente (proceso concurrente)
test('17: resolved concurrente devuelve el episodio existente sin duplicar', async () => {
  const before = (await repository.listAlarms({})).length;
  const { alarm, created } = await repository.createResolvedAlarmEpisode({
    plantId: PLANT, deviceId: MIN, provider: 'hyxi', externalAlarmId: '2400800',
    alarmCode: '5459', title: 'Grid Frequency Overrun Fault',
    startedAt: T0, resolvedAt: T1, firstSeenAt: T1, lastSeenAt: T1,
    rawPayload: { id: 2400800 },
  });
  assert.equal(created, false);
  assert.equal(alarm.external_alarm_id, '2400800');
  assert.equal((await repository.listAlarms({})).length, before);
});

// 18. active concurrente contra resolved existente → 23505 → relectura por ID externo
test('18: active concurrente sobre resolved existente no duplica', async () => {
  const before = (await repository.listAlarms({})).length;
  const { alarm, created } = await repository.createAlarmEpisode({
    plantId: PLANT, deviceId: MIN, provider: 'hyxi', externalAlarmId: '2400800',
    alarmCode: '5459', title: 'Grid Frequency Overrun Fault',
  });
  assert.equal(created, false);
  assert.equal(alarm.status, 'resolved');
  assert.equal(alarm.external_alarm_id, '2400800');
  assert.equal((await repository.listAlarms({})).length, before);
});

// 19. 23505 sin fila visible → error explícito (no se oculta)
test('19: 23505 fantasma falla explícitamente', async () => {
  forcedInsertErrors.set('PHANTOM-1', '23505');
  try {
    await assert.rejects(repository.createResolvedAlarmEpisode({
      plantId: PLANT, deviceId: MIN, provider: 'hyxi', externalAlarmId: 'PHANTOM-1',
      alarmCode: '5459', title: 'Fantasma', resolvedAt: T1,
    }), /resuelto/);
  } finally {
    forcedInsertErrors.delete('PHANTOM-1');
  }
});

// 20. error distinto de 23505 propaga
test('20: error de insert no-23505 propaga sin releer', async () => {
  forcedInsertErrors.set('BOOM-1', 'XX000');
  try {
    await assert.rejects(repository.createResolvedAlarmEpisode({
      plantId: PLANT, deviceId: MIN, provider: 'hyxi', externalAlarmId: 'BOOM-1',
      alarmCode: '5459', title: 'Boom', resolvedAt: T1,
    }), /resuelto/);
    await assert.rejects(repository.createAlarmEpisode({
      plantId: PLANT, deviceId: MIN, provider: 'hyxi', externalAlarmId: 'BOOM-1',
      alarmCode: '5459', title: 'Boom',
    }), /episodio de alarma/);
  } finally {
    forcedInsertErrors.delete('BOOM-1');
  }
});

// 21. findAlarmByExternalId en cualquier estado + touch de observación
test('21: lookup por ID externo encuentra resolved y touch no degrada', async () => {
  const found = await repository.findAlarmByExternalId('hyxi', '2400800');
  assert.equal(found.status, 'resolved');
  assert.equal(await repository.findAlarmByExternalId('hyxi', 'NO-EXISTE'), null);
  assert.equal(await repository.findAlarmByExternalId('hyxi', null), null);
  const touched = await repository.touchAlarmObservation(found.id, { lastSeenAt: T2, rawPayload: { id: 2400800, seen: 2 } });
  assert.equal(touched.last_seen_at, T2);
  assert.equal(touched.status, 'resolved');
  assert.equal(touched.started_at, T0);
  assert.equal(touched.resolved_at, T1);
});
