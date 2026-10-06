import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Store en memoria con la misma identidad activa de 034 (sin UUID mágicos).
const alarmStore = [];
let alarmSeq = 0;
const calls = { create: 0, touch: 0, resolve: 0, find: 0, list: 0 };
const failCreateFor = new Set();

function identity(row) {
  return `${row.device_id}|${row.alarm_code}|${row.external_alarm_id ?? ''}`;
}

mock.module('../src/repositories/alarms.repository.js', {
  namedExports: {
    async findActiveAlarm({ deviceId, alarmCode, externalAlarmId = null }) {
      calls.find += 1;
      return alarmStore.find(row => row.status === 'active'
        && row.device_id === deviceId && row.alarm_code === alarmCode
        && (row.external_alarm_id ?? null) === (externalAlarmId ?? null)) ?? null;
    },
    async createAlarmEpisode(values) {
      calls.create += 1;
      if (failCreateFor.has(values.alarmCode)) throw new Error('persist failed');
      const clash = alarmStore.some(row => row.status === 'active' && identity(row) === identity({
        device_id: values.deviceId, alarm_code: values.alarmCode, external_alarm_id: values.externalAlarmId ?? null,
      }));
      if (clash) {
        const existing = alarmStore.find(row => row.status === 'active' && identity(row) === identity({
          device_id: values.deviceId, alarm_code: values.alarmCode, external_alarm_id: values.externalAlarmId ?? null,
        }));
        return { alarm: existing, created: false };
      }
      const row = {
        id: `e${++alarmSeq}`,
        plant_id: values.plantId, device_id: values.deviceId, provider: values.provider,
        external_alarm_id: values.externalAlarmId ?? null, alarm_code: values.alarmCode,
        title: values.title, description: values.description ?? null, severity: values.severity ?? null,
        status: 'active', started_at: values.startedAt ?? null, resolved_at: null,
        first_seen_at: values.firstSeenAt, last_seen_at: values.lastSeenAt,
        raw_payload: values.rawPayload ?? null, updated_at: values.updatedAt ?? null,
      };
      alarmStore.push(row);
      return { alarm: row, created: true };
    },
    async touchActiveAlarm(id, { lastSeenAt, rawPayload }) {
      calls.touch += 1;
      const row = alarmStore.find(entry => entry.id === id && entry.status === 'active');
      if (!row) return null;
      row.last_seen_at = lastSeenAt;
      if (rawPayload !== undefined) row.raw_payload = rawPayload;
      return row;
    },
    async resolveAlarm(id, { resolvedAt }) {
      calls.resolve += 1;
      const row = alarmStore.find(entry => entry.id === id && entry.status === 'active');
      if (!row) return null;
      row.status = 'resolved';
      row.resolved_at = resolvedAt;
      return row;
    },
    async listAlarms({ deviceId } = {}) {
      calls.list += 1;
      return alarmStore.filter(row => !deviceId || row.device_id === deviceId);
    },
  },
});

const { extractGrowattAlarmIdentities, syncGrowattAlarmSnapshot } = await import('../src/services/growattAlarmSync.service.js');

const PLANT = '11111111-1111-4111-8111-111111111111';
const MIN = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const MIN2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const C1 = '2026-10-06T10:00:00.000Z';
const C2 = '2026-10-06T10:05:00.000Z';
const C3 = '2026-10-06T10:10:00.000Z';
const OBS = '2026-10-06T10:05:30.000Z';

function reset() { alarmStore.length = 0; alarmSeq = 0; failCreateFor.clear(); Object.keys(calls).forEach(key => { calls[key] = 0; }); }
function normalRaw(overrides = {}) {
  return { status: 1, statusText: 'Normal', lost: false, faultType: 0, warnCode: 0, time: '2026-10-06 06:00:00', ...overrides };
}
function sync(overrides = {}) {
  return syncGrowattAlarmSnapshot({ deviceId: MIN, plantId: PLANT, raw: normalRaw(), collectedAt: C1, observedAt: OBS, ...overrides });
}

// 1. snapshot normal → cero alarms
test('1: snapshot normal no crea episodios', async () => {
  reset();
  const result = await sync();
  assert.equal(result.processed, true);
  assert.deepEqual([result.created.length, result.touched.length, result.resolved.length], [0, 0, 0]);
  assert.equal(calls.create, 0);
});

// 2. faultType=5 → FAULT:5
test('2: faultType=5 crea FAULT:5 critical sin started_at', async () => {
  reset();
  const result = await sync({ raw: normalRaw({ status: 3, faultType: 5 }) });
  assert.equal(result.created.length, 1);
  const alarm = result.created[0];
  assert.equal(alarm.alarm_code, 'FAULT:5');
  assert.equal(alarm.title, 'Growatt fault 5');
  assert.equal(alarm.severity, 'critical');
  assert.equal(alarm.started_at, null);
  assert.equal(alarm.first_seen_at, C1);
  assert.equal(alarm.provider, 'growatt');
});

// 3. mismo fault snapshot nuevo → touch, no duplica
test('3: fault repetido en snapshot nuevo hace touch', async () => {
  reset();
  await sync({ raw: normalRaw({ faultType: 5 }) });
  const result = await sync({ raw: normalRaw({ faultType: 5 }), collectedAt: C2 });
  assert.equal(result.created.length, 0);
  assert.equal(result.touched.length, 1);
  assert.equal(result.touched[0].last_seen_at, OBS);
  assert.equal(alarmStore.length, 1);
});

// 4. fault desaparece en snapshot NUEVO → resolve con collected_at
test('4: ausencia en snapshot nuevo resuelve con resolved_at del snapshot', async () => {
  reset();
  await sync({ raw: normalRaw({ faultType: 5 }) });
  const result = await sync({ raw: normalRaw(), collectedAt: C2 });
  assert.equal(result.resolved.length, 1);
  assert.equal(result.resolved[0].status, 'resolved');
  assert.equal(result.resolved[0].resolved_at, C2);
});

// 5. resuelta y reaparece → nuevo episodio
test('5: reaparición crea episodio con ID distinto', async () => {
  reset();
  const first = (await sync({ raw: normalRaw({ faultType: 5 }) })).created[0];
  await sync({ raw: normalRaw(), collectedAt: C2 });
  const second = (await sync({ raw: normalRaw({ faultType: 5 }), collectedAt: C3 })).created[0];
  assert.notEqual(second.id, first.id);
  assert.equal(second.status, 'active');
});

// 6. warnCode=3 → WARN:3
test('6: warnCode=3 crea WARN:3 warning', async () => {
  reset();
  const result = await sync({ raw: normalRaw({ warnCode: 3 }) });
  assert.equal(result.created[0].alarm_code, 'WARN:3');
  assert.equal(result.created[0].severity, 'warning');
  assert.equal(result.created[0].title, 'Growatt warning 3');
});

// 7. fault + warning simultáneos → 2 activas
test('7: fault y warning simultáneos son dos episodios', async () => {
  reset();
  const result = await sync({ raw: normalRaw({ faultType: 5, warnCode: 3 }) });
  assert.deepEqual(result.created.map(alarm => alarm.alarm_code).sort(), ['FAULT:5', 'WARN:3']);
});

// 8. status fault sin códigos → STATUS:FAULT
test('8: status 3 sin códigos crea STATUS:FAULT', async () => {
  reset();
  const result = await sync({ raw: normalRaw({ status: 3, statusText: 'Fault' }) });
  assert.equal(result.created.length, 1);
  assert.equal(result.created[0].alarm_code, 'STATUS:FAULT');
  assert.equal(result.created[0].severity, 'critical');
});

// 9. ceros/inválidos → nada
test('9: faultType/warnCode 0 o inválidos no crean alarmas', async () => {
  reset();
  for (const raw of [
    normalRaw({ faultType: 0, warnCode: 0 }),
    normalRaw({ faultType: '0', warnCode: '00' }),
    normalRaw({ faultType: 'invalid', warnCode: false }),
    normalRaw({ status: 1 }),
  ]) {
    const result = await sync({ raw });
    assert.equal(result.created.length, 0, JSON.stringify(raw));
  }
});

// 10. errorText/warnText reales usados
test('10: títulos usan errorText/warnText del fabricante', async () => {
  reset();
  const fault = await sync({ raw: normalRaw({ faultType: 5, errorText: 'PV isolation low' }) });
  assert.equal(fault.created[0].title, 'PV isolation low');
  reset();
  const warn = await sync({ raw: normalRaw({ warnCode: 3, warnText: 'Grid volt high' }) });
  assert.equal(warn.created[0].title, 'Grid volt high');
});

// 11/12. sysFaultWord/bms/bdc no crean alarmas pero quedan en raw_payload
test('11/12: campos sin semántica no generan episodios pero se conservan', async () => {
  reset();
  const raw = normalRaw({ sysFaultWord1: 7, bmsFaultType: 2, bdc1FaultType: 1, newWarnCode: 9 });
  const result = await sync({ raw });
  assert.equal(result.created.length, 0);
  reset();
  const withFault = await sync({ raw: { ...raw, faultType: 5 } });
  const payload = withFault.created[0].raw_payload;
  assert.equal(payload.sysFaultWord1, 7);
  assert.equal(payload.bmsFaultType, 2);
  assert.equal(payload.bdc1FaultType, 1);
  assert.equal(payload.newWarnCode, 9);
  assert.equal(payload.faultType, 5);
});

// 13. snapshot repetido mismo collected_at → sin touch ni resolve
test('13: collected_at repetido se ignora por completo', async () => {
  reset();
  await sync({ raw: normalRaw({ faultType: 5 }) });
  const before = { create: calls.create, touch: calls.touch, resolve: calls.resolve };
  const result = await sync({ raw: normalRaw({ faultType: 5 }) });
  assert.equal(result.processed, false);
  assert.equal(result.reason, 'duplicate-snapshot');
  assert.deepEqual({ create: calls.create, touch: calls.touch, resolve: calls.resolve }, before);
});

// 14/15/16. sin snapshot válido → nada y sin resolve
test('14/15/16: raw ausente o inválido no toca ni resuelve', async () => {
  reset();
  await sync({ raw: normalRaw({ faultType: 5 }) });
  const activeId = alarmStore[0].id;
  for (const raw of [null, undefined, 'texto', []]) {
    const result = await sync({ raw, collectedAt: C2 });
    assert.equal(result.processed, false, JSON.stringify(raw));
  }
  assert.equal(alarmStore.find(row => row.id === activeId).status, 'active');
  // collected_at inválido: permite touch/crear pero jamás resuelve
  const noResolve = await sync({ raw: normalRaw(), collectedAt: 'no-fecha' });
  assert.equal(noResolve.resolved.length, 0);
  assert.equal(alarmStore.find(row => row.id === activeId).status, 'active');
});

// 17. dos devices mismo código → independientes
test('17: mismo código en dos dispositivos son episodios independientes', async () => {
  reset();
  await sync({ raw: normalRaw({ faultType: 5 }) });
  const other = await sync({ deviceId: MIN2, raw: normalRaw({ faultType: 5 }) });
  assert.equal(other.created.length, 1);
  assert.notEqual(other.created[0].id, alarmStore[0].id);
});

// 18. resolución y reaparición → IDs distintos (cubierto en 5, resuelve solo ausentes)
test('18: resolve solo cierra identidades ausentes del snapshot', async () => {
  reset();
  await sync({ raw: normalRaw({ faultType: 5, warnCode: 3 }) });
  const result = await sync({ raw: normalRaw({ warnCode: 3 }), collectedAt: C2 });
  assert.equal(result.resolved.length, 1);
  assert.equal(result.resolved[0].alarm_code, 'FAULT:5');
  assert.equal(result.touched.length, 1);
});

// 19. first_seen vs started_at
test('19: first_seen usa collected_at; sin él usa observación; started_at siempre NULL', async () => {
  reset();
  const withCollected = (await sync({ raw: normalRaw({ faultType: 5 }) })).created[0];
  assert.equal(withCollected.first_seen_at, C1);
  assert.equal(withCollected.started_at, null);
  reset();
  const withoutCollected = (await sync({ raw: normalRaw({ faultType: 5 }), collectedAt: null })).created[0];
  assert.equal(withoutCollected.first_seen_at, OBS);
  assert.equal(withoutCollected.started_at, null);
});

// 20. severidades RDX
test('20: FAULT critical, WARN warning, STATUS:FAULT critical', async () => {
  reset();
  const result = await sync({ raw: normalRaw({ status: 3, faultType: 5, warnCode: 3 }) });
  const byCode = new Map(result.created.map(alarm => [alarm.alarm_code, alarm.severity]));
  assert.equal(byCode.get('FAULT:5'), 'critical');
  assert.equal(byCode.get('WARN:3'), 'warning');
  reset();
  const fallback = await sync({ raw: normalRaw({ status: 3 }) });
  assert.equal(fallback.created[0].severity, 'critical');
});

// 21. sin llamadas al fabricante: fetch roto no afecta
test('21: el sync no usa la red del fabricante', async () => {
  reset();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('no debe llamarse'); };
  try {
    const result = await sync({ raw: normalRaw({ faultType: 5 }) });
    assert.equal(result.created.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Snapshot viejo desordenado no resuelve
test('extra: collected_at anterior al procesado se ignora', async () => {
  reset();
  await sync({ raw: normalRaw({ faultType: 5 }), collectedAt: C2 });
  const result = await sync({ raw: normalRaw(), collectedAt: C1 });
  assert.equal(result.processed, false);
  assert.equal(alarmStore[0].status, 'active');
});

// ---- Auditoría Fase 1+2: secuencia completa de marcador ----
test('audit: secuencia C1→C1→C2→C3→C4 con dos alarmas', async () => {
  reset();
  const c1 = await sync({ raw: normalRaw({ faultType: 5, warnCode: 3 }) });
  assert.equal(c1.created.length, 2);
  const faultId = c1.created.find(alarm => alarm.alarm_code === 'FAULT:5').id;
  const warnId = c1.created.find(alarm => alarm.alarm_code === 'WARN:3').id;
  for (const alarm of c1.created) {
    assert.equal(alarm.raw_payload._rdx.collected_at, C1);
  }
  // C1 repetido: ignorado por completo aunque haya activas
  const writesBefore = { create: calls.create, touch: calls.touch, resolve: calls.resolve };
  const repeat = await sync({ raw: normalRaw({ faultType: 5, warnCode: 3 }) });
  assert.equal(repeat.processed, false);
  assert.deepEqual({ create: calls.create, touch: calls.touch, resolve: calls.resolve }, writesBefore);
  // C2 mismo set: toca ambas con marcador C2, mismos episodios
  const c2 = await sync({ raw: normalRaw({ faultType: 5, warnCode: 3 }), collectedAt: C2 });
  assert.deepEqual(c2.touched.map(alarm => alarm.id).sort(), [faultId, warnId].sort());
  assert.equal(c2.created.length, 0);
  assert.equal(c2.resolved.length, 0);
  for (const alarm of c2.touched) assert.equal(alarm.raw_payload._rdx.collected_at, C2);
  // C3 solo FAULT:5 → touch fault con C3, WARN:3 resuelta en C3
  const c3 = await sync({ raw: normalRaw({ faultType: 5 }), collectedAt: C3 });
  assert.deepEqual(c3.touched.map(alarm => alarm.id), [faultId]);
  assert.equal(c3.touched[0].raw_payload._rdx.collected_at, C3);
  assert.equal(c3.resolved.length, 1);
  assert.equal(c3.resolved[0].id, warnId);
  assert.equal(c3.resolved[0].resolved_at, C3);
  // C4 sin alarmas → FAULT:5 resuelta
  const c4 = await sync({ raw: normalRaw(), collectedAt: '2026-10-06T10:15:00.000Z' });
  assert.deepEqual(c4.resolved.map(alarm => alarm.id), [faultId]);
});

// Cero activas: repetido es no-op redundante pero seguro
test('audit: sin filas, el repetido no crea ni resuelve nada', async () => {
  reset();
  const first = await sync({ raw: normalRaw() });
  assert.equal(first.processed, true);
  const second = await sync({ raw: normalRaw() });
  assert.equal(second.processed, true);
  assert.equal(calls.create, 0);
  assert.equal(alarmStore.length, 0);
  // Luego C2 con falla sí crea (no quedó estado corrupto)
  const third = await sync({ raw: normalRaw({ faultType: 5 }), collectedAt: C2 });
  assert.equal(third.created.length, 1);
});

// Fuera de orden con falla presente o distinta: tampoco crea ni toca
test('audit: C1 tardío con falla no crea episodio', async () => {
  reset();
  await sync({ raw: normalRaw({ faultType: 5 }), collectedAt: C2 });
  for (const raw of [normalRaw({ faultType: 5 }), normalRaw({ faultType: 9 }), normalRaw()]) {
    const result = await sync({ raw, collectedAt: C1 });
    assert.equal(result.processed, false, JSON.stringify(raw.faultType));
  }
  assert.equal(alarmStore.length, 1);
  assert.equal(alarmStore[0].status, 'active');
});

// Transición multi-alarma con código cambiado
test('audit: WARN:3→WARN:4 resuelve, crea y conserva FAULT:5', async () => {
  reset();
  await sync({ raw: normalRaw({ faultType: 5, warnCode: 3 }) });
  const faultId = alarmStore.find(row => row.alarm_code === 'FAULT:5').id;
  const result = await sync({ raw: normalRaw({ faultType: 5, warnCode: 4 }), collectedAt: C2 });
  assert.deepEqual(result.touched.map(alarm => alarm.id), [faultId]);
  assert.equal(result.resolved.length, 1);
  assert.equal(result.resolved[0].alarm_code, 'WARN:3');
  assert.equal(result.created.length, 1);
  assert.equal(result.created[0].alarm_code, 'WARN:4');
});

// STATUS:FAULT → código real: se resuelve fallback y nace FAULT:5
test('audit: STATUS:FAULT cede ante código real nuevo', async () => {
  reset();
  const first = await sync({ raw: normalRaw({ status: 'fault', faultType: 0, warnCode: 0 }) });
  assert.equal(first.created[0].alarm_code, 'STATUS:FAULT');
  const second = await sync({ raw: normalRaw({ status: 'fault', faultType: 5 }), collectedAt: C2 });
  assert.equal(second.resolved.length, 1);
  assert.equal(second.resolved[0].alarm_code, 'STATUS:FAULT');
  assert.equal(second.created.length, 1);
  assert.equal(second.created[0].alarm_code, 'FAULT:5');
});

// Código real → STATUS:FAULT: eventos distintos (V1 documentado)
test('audit: pérdida de código abre STATUS:FAULT sin asumir mismo evento', async () => {
  reset();
  await sync({ raw: normalRaw({ status: 'fault', faultType: 5 }) });
  const result = await sync({ raw: normalRaw({ status: 'fault', faultType: 0, warnCode: 0 }), collectedAt: C2 });
  assert.equal(result.resolved.length, 1);
  assert.equal(result.resolved[0].alarm_code, 'FAULT:5');
  assert.equal(result.created.length, 1);
  assert.equal(result.created[0].alarm_code, 'STATUS:FAULT');
});

// Fallo parcial: si una persistencia falla, no hay resolución
test('audit: fallo parcial de persistencia bloquea la resolución', async () => {
  reset();
  await sync({ raw: normalRaw({ faultType: 5, warnCode: 3 }) });
  failCreateFor.add('WARN:4');
  await assert.rejects(
    sync({ raw: normalRaw({ faultType: 5, warnCode: 4 }), collectedAt: C2 }),
    /persist failed/,
  );
  // FAULT:5 se tocó (estaba presente), pero WARN:3 NO se resolvió
  assert.equal(alarmStore.find(row => row.alarm_code === 'WARN:3').status, 'active');
  assert.equal(calls.resolve, 0);
});

// Marcador monotónico: touch con collected NULL no retrocede la marca
test('audit: touch sin collected_at conserva el marcador y frena snapshots viejos', async () => {
  reset();
  await sync({ raw: normalRaw({ faultType: 5 }), collectedAt: C2 });
  const touched = await sync({ raw: normalRaw({ faultType: 5 }), collectedAt: null });
  assert.equal(touched.touched.length, 1);
  assert.equal(touched.touched[0].raw_payload._rdx.collected_at, C2);
  // Un snapshot viejo posterior sigue reconociéndose como ya procesado
  const stale = await sync({ raw: normalRaw(), collectedAt: C1 });
  assert.equal(stale.processed, false);
  assert.equal(alarmStore[0].status, 'active');
});
