import assert from 'node:assert/strict';
import test from 'node:test';

import { calculatePlantEconomics } from '../src/services/plantEconomics.service.js';

const context = { period: 'day', start: '2026-09-29', end: '2026-09-30' };
const row = (time, overrides = {}) => ({
  interval_start: `2026-09-29T${time}Z`,
  timezone: 'America/La_Paz',
  generation_kwh: 3,
  consumption_kwh: 2,
  grid_import_kwh: 0,
  grid_export_kwh: 2,
  raw_data: {},
  ...overrides,
});
const tariff = (overrides = {}) => ({
  effective_from: '2026-01-01',
  effective_to: null,
  purchase_energy_rate: 1.068,
  export_energy_rate: null,
  currency: 'BOB',
  export_compensation_type: 'energy_credit',
  ...overrides,
});

test('energy_credit + export EXACT refleja el crédito en kWh', () => {
  const rows = [row('10:00:00.000'), row('10:15:00.000'), row('10:30:00.000')];
  const result = calculatePlantEconomics(rows, [tariff()], context);
  assert.deepEqual(result.metrics.energy_credit_generated_kwh, {
    value: 6, valid_intervals: 3, total_intervals: 3, complete: true, quality: 'EXACT',
  });
  assert.ok(Math.abs(result.export_credit_estimated_value - 6 * 1.068) < 1e-9);
  assert.ok(Math.abs(result.estimated_economic_benefit
    - (result.self_consumption_savings + 6 * 1.068)) < 1e-9);
});

test('energy_credit + export PARTIAL conserva valor y conteos sin estimar', () => {
  const rows = [
    row('10:00:00.000'), row('10:15:00.000'), row('10:30:00.000'),
    row('10:45:00.000', { grid_export_kwh: null }),
    row('11:00:00.000', { grid_export_kwh: null }),
  ];
  const result = calculatePlantEconomics(rows, [tariff()], context);
  assert.deepEqual(result.metrics.energy_credit_generated_kwh, {
    value: 6, valid_intervals: 3, total_intervals: 5, complete: false, quality: 'PARTIAL',
  });
  assert.equal(result.export_credit_estimated_value, null);
});

test('export no disponible deja el crédito no disponible', () => {
  const rows = [
    row('10:00:00.000', { grid_export_kwh: null }),
    row('10:15:00.000', { grid_export_kwh: null }),
  ];
  const result = calculatePlantEconomics(rows, [tariff()], context);
  assert.deepEqual(result.metrics.energy_credit_generated_kwh, {
    value: null, valid_intervals: 0, total_intervals: 2, complete: false, quality: 'UNAVAILABLE',
  });
});

test('modalidad monetary conserva el comportamiento existente', () => {
  const rows = [row('10:00:00.000'), row('10:15:00.000')];
  const result = calculatePlantEconomics(rows, [tariff({
    export_compensation_type: 'monetary', export_energy_rate: 0.5,
  })], context);
  assert.equal(result.export_value, 2);
  assert.equal(result.metrics.energy_credit_generated_kwh.quality, 'UNAVAILABLE');
  assert.equal(result.metrics.energy_credit_generated_kwh.value, null);
});

test('meter_suspect no genera un crédito válido', () => {
  const rows = [
    row('10:00:00.000', { consumption_kwh: 0, grid_import_kwh: 0, grid_export_kwh: 0 }),
    row('10:15:00.000', { consumption_kwh: 0, grid_import_kwh: 0, grid_export_kwh: 0 }),
  ];
  const result = calculatePlantEconomics(rows, [tariff()], context);
  assert.equal(result.coverage.meter_suspect, true);
  assert.equal(result.metrics.energy_credit_generated_kwh.quality, 'SUSPECT');
});

test('1:1 con purchase=1.068 y credito 27.4 estima ~29.2632', () => {
  const rows = [row('10:00:00.000', { generation_kwh: 30, grid_export_kwh: 27.4 })];
  const result = calculatePlantEconomics(rows, [tariff()], context);
  assert.ok(Math.abs(result.export_credit_estimated_value - 27.4 * 1.068) < 1e-9);
  assert.ok(Math.abs(result.metrics.export_value.value - 27.4 * 1.068) < 1e-9);
  assert.equal(result.metrics.export_value.quality, 'EXACT');
  assert.ok(Math.abs(result.estimated_economic_benefit
    - (result.self_consumption_savings + 27.4 * 1.068)) < 1e-9);
});

test('1:1 PARTIAL conserva cobertura y no estima faltantes', () => {
  const rows = [
    row('10:00:00.000', { generation_kwh: 10, grid_export_kwh: 8 }),
    row('10:15:00.000', { generation_kwh: 10, grid_export_kwh: 8 }),
    row('10:30:00.000', { generation_kwh: 10, grid_export_kwh: null }),
  ];
  const result = calculatePlantEconomics(rows, [tariff()], context);
  assert.deepEqual(result.metrics.export_value, {
    value: 16 * 1.068, valid_intervals: 2, total_intervals: 3, complete: false, quality: 'PARTIAL',
  });
  assert.ok(Math.abs(result.metrics.export_value.value - 16 * 1.068) < 1e-9);
  assert.equal(result.export_value, null);
});

test('1:1 usa purchase aunque exista export rate distinta', () => {
  const rows = [row('10:00:00.000', { generation_kwh: 30, grid_export_kwh: 27.4 })];
  const result = calculatePlantEconomics(rows, [tariff({ export_energy_rate: 0.25 })], context);
  assert.ok(Math.abs(result.export_credit_estimated_value - 27.4 * 1.068) < 1e-9);
  assert.ok(Math.abs(result.estimated_economic_benefit
    - (result.self_consumption_savings + 27.4 * 1.068)) < 1e-9);
});

test('monetary sigue usando export rate y none intacto', () => {
  const rows = [row('10:00:00.000', { generation_kwh: 30, grid_export_kwh: 27.4 })];
  const monetary = calculatePlantEconomics(rows, [tariff({
    export_compensation_type: 'monetary', export_energy_rate: 0.5,
  })], context);
  assert.ok(Math.abs(monetary.export_value - 27.4 * 0.5) < 1e-9);
  const none = calculatePlantEconomics(rows, [tariff({
    export_compensation_type: 'none', export_energy_rate: null,
  })], context);
  assert.equal(none.export_value, 0);
  assert.equal(none.metrics.energy_credit_generated_kwh.quality, 'UNAVAILABLE');
});
