import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeHyxiEnergyRows } from '../src/services/hyxiEnergyHistory.service.js';

const existing = (time, overrides = {}) => ({
  interval_start: `${time}.000Z`,
  timezone: 'America/La_Paz',
  provider: 'hyxi',
  updated_at: '2026-09-01T20:00:00.000Z',
  generation_kwh: 10,
  consumption_kwh: 12,
  grid_import_kwh: 3,
  grid_export_kwh: 2,
  battery_charge_kwh: null,
  battery_discharge_kwh: null,
  raw_data: { timePoint: 1, yield: [10] },
  ...overrides,
});
const candidate = (time, overrides = {}) => ({
  interval_start: `${time}.000Z`,
  timezone: 'America/La_Paz',
  provider: 'hyxi',
  updated_at: '2026-09-10T20:00:00.000Z',
  generation_kwh: 10,
  consumption_kwh: 12,
  grid_import_kwh: 3,
  grid_export_kwh: 2,
  battery_charge_kwh: null,
  battery_discharge_kwh: null,
  raw_data: { timePoint: 1, yield: [10] },
  ...overrides,
});

test('A) existing completo + candidate con NULL preserva valores y raw_data', () => {
  const { rows, stats } = mergeHyxiEnergyRows(
    [existing('2026-09-10T16:00:00')],
    [candidate('2026-09-10T16:00:00', {
      generation_kwh: null, consumption_kwh: null,
      grid_import_kwh: null, grid_export_kwh: null, raw_data: {},
    })],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].generation_kwh, 10);
  assert.equal(rows[0].consumption_kwh, 12);
  assert.equal(rows[0].grid_import_kwh, 3);
  assert.equal(rows[0].grid_export_kwh, 2);
  // Sin aporte: se conserva la fila existente intacta (incluido updated_at).
  assert.equal(rows[0].updated_at, '2026-09-01T20:00:00.000Z');
  assert.deepEqual(rows[0].raw_data, { timePoint: 1, yield: [10] });
  assert.ok(stats.preserved > 0);
  assert.equal(stats.filled, 0);
});

test('B) existing parcial + candidate completa rellena NULLs', () => {
  const { rows, stats } = mergeHyxiEnergyRows(
    [existing('2026-09-10T16:00:00', { consumption_kwh: null, grid_export_kwh: null })],
    [candidate('2026-09-10T16:00:00')],
  );
  assert.equal(rows[0].consumption_kwh, 12);
  assert.equal(rows[0].grid_export_kwh, 2);
  assert.equal(rows[0].generation_kwh, 10);
  assert.equal(stats.filled, 2);
});

test('C) valor directo nuevo y válido actualiza el existente', () => {
  const { rows, stats } = mergeHyxiEnergyRows(
    [existing('2026-09-10T16:00:00')],
    [candidate('2026-09-10T16:00:00', {
      generation_kwh: 11, grid_import_kwh: 4, raw_data: { timePoint: 2, yield: [11] },
    })],
  );
  assert.equal(rows[0].generation_kwh, 11);
  assert.equal(rows[0].grid_import_kwh, 4);
  assert.equal(rows[0].consumption_kwh, 12);
  assert.equal(stats.updated, 2);
  // Nueva evidencia: raw_data del candidato.
  assert.deepEqual(rows[0].raw_data, { timePoint: 2, yield: [11] });
  assert.equal(rows[0].updated_at, '2026-09-10T20:00:00.000Z');
});

test('D) timestamp nuevo se inserta normal', () => {
  const { rows, stats } = mergeHyxiEnergyRows(
    [existing('2026-09-10T16:00:00')],
    [candidate('2026-09-11T16:00:00', { generation_kwh: null })],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].interval_start, '2026-09-11T16:00:00.000Z');
  assert.equal(rows[0].generation_kwh, null);
  assert.equal(stats.inserted, 1);
});

test('E) candidate vacío no toca existing', () => {
  const { rows, stats } = mergeHyxiEnergyRows([existing('2026-09-10T16:00:00')], []);
  assert.deepEqual(rows, []);
  assert.deepEqual(stats, { inserted: 0, filled: 0, updated: 0, preserved: 0, unchanged: 0 });
});

test('F) fallback derivado solo rellena NULLs, nunca reemplaza medición directa', () => {
  const derived = candidate('2026-09-10T16:00:00', {
    generation_kwh: 9,
    consumption_kwh: 99,
    raw_data: { derived_from: 'plant_power_intervals', interval_hours: 1 },
  });
  const { rows, stats } = mergeHyxiEnergyRows(
    [existing('2026-09-10T16:00:00', { consumption_kwh: null })],
    [derived],
  );
  // Estimación rellena el NULL pero respeta la medición directa existente.
  assert.equal(rows[0].consumption_kwh, 99);
  assert.equal(rows[0].generation_kwh, 10);
  assert.equal(stats.filled, 1);
  assert.ok(stats.preserved > 0);
});

test('G) reejecución idéntica es idempotente', () => {
  const stored = existing('2026-09-10T16:00:00');
  const { rows, stats } = mergeHyxiEnergyRows(
    [stored],
    [candidate('2026-09-10T16:00:00')],
  );
  assert.deepEqual(rows, [stored]);
  assert.equal(stats.unchanged, 1);
  assert.equal(stats.filled, 0);
  assert.equal(stats.updated, 0);
});
