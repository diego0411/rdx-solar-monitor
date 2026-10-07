import assert from 'node:assert/strict';
import test from 'node:test';

import { calculatePlantEconomics } from '../src/services/plantEconomics.service.js';

const context = { period: 'month', start: '2026-09-01', end: '2026-10-01' };
const row = (date, time, overrides = {}) => ({
  interval_start: `${date}T${time}.000Z`,
  timezone: 'America/La_Paz',
  provider: 'hyxi',
  updated_at: `${date}T20:00:00.000Z`,
  generation_kwh: 100,
  consumption_kwh: 120,
  grid_import_kwh: 50,
  grid_export_kwh: 30,
  raw_data: {},
  ...overrides,
});
const tariff = (overrides = {}) => ({
  effective_from: '2026-01-01',
  effective_to: null,
  purchase_energy_rate: 0.8,
  export_energy_rate: 0.5,
  currency: 'BOB',
  export_compensation_type: 'monetary',
  ...overrides,
});

test('A) rango con filas: rows, first/last, last_stored_at, providers, has_stored_data', () => {
  const result = calculatePlantEconomics([
    row('2026-09-23', '16:00:00', { updated_at: '2026-09-24T01:00:00.000Z' }),
    row('2026-09-10', '16:00:00', { updated_at: '2026-09-11T01:00:00.000Z' }),
    row('2026-09-20', '16:00:00', { updated_at: '2026-09-25T01:00:00.000Z' }),
  ], [tariff()], context);
  const observation = result.data_observation;
  assert.equal(observation.interval_type, 1);
  assert.equal(observation.rows.total, 3);
  assert.equal(observation.first_interval_at, '2026-09-10T16:00:00.000Z');
  assert.equal(observation.last_interval_at, '2026-09-23T16:00:00.000Z');
  assert.equal(observation.last_stored_at, '2026-09-25T01:00:00.000Z');
  assert.deepEqual(observation.providers, ['hyxi']);
  assert.deepEqual(observation.period, { start: '2026-09-01', end: '2026-10-01' });
  assert.equal(observation.has_stored_data, true);
});

test('B) rango vacío: total 0, timestamps null, providers [], has_stored_data=false', () => {
  const result = calculatePlantEconomics([], [tariff()], context);
  const observation = result.data_observation;
  assert.equal(observation.rows.total, 0);
  assert.equal(observation.first_interval_at, null);
  assert.equal(observation.last_interval_at, null);
  assert.equal(observation.last_stored_at, null);
  assert.deepEqual(observation.providers, []);
  assert.equal(observation.has_stored_data, false);
  assert.equal(result.coverage.status, 'none');
});

test('C) providers mixtos: lista reflects ambos sin alterar cálculos', () => {
  const rows = [
    row('2026-09-10', '16:00:00', { provider: 'hyxi' }),
    row('2026-09-11', '16:00:00', { provider: 'growatt' }),
  ];
  const result = calculatePlantEconomics(rows, [tariff()], context);
  assert.deepEqual(result.data_observation.providers, ['hyxi', 'growatt']);
  assert.equal(result.data_observation.rows.total, 2);
  const single = calculatePlantEconomics([rows[0]], [tariff()], context);
  assert.equal(result.generation_kwh, single.generation_kwh * 2);
});

test('D) data_observation no altera metrics, coverage ni cálculo monetario', () => {
  const rows = [row('2026-09-23', '16:00:00'), row('2026-09-24', '16:00:00')];
  const withObservation = calculatePlantEconomics(rows, [tariff()], context);
  const { data_observation: _ignored, ...rest } = withObservation;
  assert.ok(withObservation.data_observation);
  assert.equal(rest.generation_kwh, 200);
  assert.equal(rest.self_consumption_kwh, 140);
  assert.equal(rest.production_value, 160);
  assert.equal(rest.self_consumption_savings, 112);
  assert.equal(rest.export_value, 30);
  assert.equal(rest.estimated_economic_benefit, 142);
  assert.equal(rest.coverage.status, 'available');
  assert.equal(rest.metrics.generation_kwh.quality, 'EXACT');
  assert.equal(rest.metrics.self_consumption_savings.quality, 'EXACT');
});
