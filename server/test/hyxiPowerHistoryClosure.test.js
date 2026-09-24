import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHyxiPowerHistoryRows,
  createHyxiPowerHistoryWindowSync,
  localDateForTimezone,
} from '../src/services/hyxiPowerHistory.service.js';
import { shouldSyncHyxiPowerHistory } from '../src/controllers/powerHistory.controller.js';
import { createScheduledSync } from '../src/services/scheduledSync.js';

const plant = { id: 'plant-1', external_plant_id: 'external-1', timezone: 'America/La_Paz' };

test('sincroniza el día local actual y cierra ayer una sola vez', async () => {
  const calls = [];
  const run = createHyxiPowerHistoryWindowSync({
    now: () => new Date('2026-09-24T16:00:00.000Z'),
    sync: async (id, date) => { calls.push([id, date]); return { failed: 0 }; },
  });

  await run(plant);
  const second = await run(plant);

  assert.deepEqual(calls, [
    ['external-1', '2026-09-24'], ['external-1', '2026-09-23'],
    ['external-1', '2026-09-24'],
  ]);
  assert.equal(second.closure.skipped, true);
});

test('el cambio de día crea un nuevo cierre usando la zona de la planta', async () => {
  let now = new Date('2026-09-24T03:30:00.000Z');
  const calls = [];
  const run = createHyxiPowerHistoryWindowSync({
    now: () => now,
    sync: async (_, date) => { calls.push(date); return { failed: 0 }; },
  });

  assert.equal(localDateForTimezone(now, plant.timezone), '2026-09-23');
  await run(plant);
  now = new Date('2026-09-24T04:30:00.000Z');
  await run(plant);

  assert.deepEqual(calls, ['2026-09-23', '2026-09-22', '2026-09-24', '2026-09-23']);
});

test('un cierre fallido queda pendiente y una planta con error no bloquea otra', async () => {
  const calls = [];
  let failedOnce = false;
  const run = createHyxiPowerHistoryWindowSync({
    now: () => new Date('2026-09-24T16:00:00.000Z'),
    sync: async (id, date) => {
      calls.push([id, date]);
      if (id === 'external-1' && date === '2026-09-23' && !failedOnce) {
        failedOnce = true;
        throw new Error('temporary');
      }
      return { failed: 0 };
    },
  });

  const first = await run(plant);
  await run({ ...plant, id: 'plant-2', external_plant_id: 'external-2' });
  await run(plant);

  assert.equal(first.errors[0].period, 'closure');
  assert.equal(calls.filter(([, date]) => date === '2026-09-23').length, 3);
});

test('normalización conserva 0/null, fórmulas y elimina timestamps duplicados antes del upsert', () => {
  const response = { data: {
    timeZone: 'America/La_Paz',
    timePoint: [1790152200, 1790152200, 1790152500],
    yieldPower: [10, 12, 0],
    consumePower: [15, 17, null],
    buyPower: [5, 5, 0],
    sellPower: [0, 0, null],
    chargedPower: [null, null, 0],
    dischargedPower: [0, 0, null],
  } };

  const rows = buildHyxiPowerHistoryRows(response, 'plant-1', '2026-09-24T00:00:00Z');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].generation_power_w, 12);
  assert.equal(rows[0].consumption_power_w, 17);
  assert.equal(rows[1].generation_power_w, 0);
  assert.equal(rows[1].consumption_power_w, null);
  assert.equal(rows[1].grid_import_power_w, 0);
  assert.equal(rows[1].grid_export_power_w, null);
});

test('el upsert lógico inserta faltantes y reemplaza correcciones sin duplicar timestamp', () => {
  const stored = new Map([['2026-09-23T12:30:00.000Z', { generation_power_w: 100 }]]);
  const incoming = [
    ['2026-09-23T12:30:00.000Z', { generation_power_w: 110 }],
    ['2026-09-23T12:35:00.000Z', { generation_power_w: 120 }],
  ];
  incoming.forEach(([timestamp, row]) => stored.set(timestamp, row));
  assert.equal(stored.size, 2);
  assert.equal(stored.get('2026-09-23T12:30:00.000Z').generation_power_w, 110);
});

test('timeout y error liberan el lock del cierre programado', async () => {
  let attempts = 0;
  const runner = createScheduledSync({
    name: 'history-test', timeoutMs: 10,
    logger: { info() {}, warn() {}, error() {} },
    sync: () => ++attempts === 1 ? new Promise(() => {}) : Promise.resolve({ ok: true }),
  });
  assert.equal((await runner()).failed, true);
  assert.deepEqual(await runner(), { ok: true });
});

test('GET conserva Supabase-first cuando ya existen filas HYXi', () => {
  assert.equal(shouldSyncHyxiPowerHistory([{ interval_start: '2026-09-23T12:00:00Z' }]), false);
  assert.equal(shouldSyncHyxiPowerHistory([]), true);
});
