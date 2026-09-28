import assert from 'node:assert/strict';
import test from 'node:test';

import { calculatePlantEconomics } from '../src/services/plantEconomics.service.js';

const context = { period: 'month', start: '2026-09-01', end: '2026-10-01' };
const row = (date, overrides = {}) => ({
  interval_start: `${date}T16:00:00.000Z`,
  timezone: 'America/La_Paz',
  provider: 'hyxi',
  generation_kwh: 1000,
  consumption_kwh: 1200,
  grid_import_kwh: 500,
  grid_export_kwh: 300,
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

test('monetary calcula valor, autoconsumo, ahorro y beneficio sin confundir producción con ahorro', () => {
  const result = calculatePlantEconomics([row('2026-09-23')], [tariff()], context);
  assert.equal(result.self_consumption_kwh, 700);
  assert.equal(result.production_value, 800);
  assert.equal(result.self_consumption_savings, 560);
  assert.equal(result.export_value, 150);
  assert.equal(result.estimated_economic_benefit, 710);
  assert.notEqual(result.production_value, result.self_consumption_savings);
  assert.equal(result.currency, 'BOB');
});

test('energy_credit conserva kWh y no los convierte a dinero sin tarifa explícita', () => {
  const result = calculatePlantEconomics([row('2026-09-23')], [tariff({
    export_compensation_type: 'energy_credit', export_energy_rate: null,
  })], context);
  assert.equal(result.export_credit_kwh, 300);
  assert.equal(result.export_value, null);
  assert.equal(result.estimated_economic_benefit, null);
  assert.equal(result.self_consumption_savings, 560);
});

test('energy_credit admite valoración monetaria solo con tarifa explícita', () => {
  const result = calculatePlantEconomics([row('2026-09-23')], [tariff({
    export_compensation_type: 'energy_credit', export_energy_rate: 0.25,
  })], context);
  assert.equal(result.export_credit_kwh, 300);
  assert.equal(result.export_value, 75);
  assert.equal(result.estimated_economic_benefit, 635);
});

test('none fija compensación de exportación en cero', () => {
  const result = calculatePlantEconomics([row('2026-09-23')], [tariff({
    export_compensation_type: 'none', export_energy_rate: null,
  })], context);
  assert.equal(result.export_value, 0);
  assert.equal(result.export_credit_kwh, null);
  assert.equal(result.estimated_economic_benefit, 560);
});

test('selecciona tarifas distintas según la vigencia de cada intervalo', () => {
  const result = calculatePlantEconomics([
    row('2026-09-14', { generation_kwh: 10, grid_export_kwh: 0 }),
    row('2026-09-15', { generation_kwh: 10, grid_export_kwh: 0 }),
  ], [
    tariff({ effective_from: '2026-01-01', effective_to: '2026-09-14', purchase_energy_rate: 0.5, export_compensation_type: 'none', export_energy_rate: null }),
    tariff({ effective_from: '2026-09-15', purchase_energy_rate: 1, export_compensation_type: 'none', export_energy_rate: null }),
  ], context);
  assert.equal(result.production_value, 15);
  assert.equal(result.self_consumption_savings, 15);
});

test('no suma importes monetarios expresados en monedas diferentes', () => {
  const result = calculatePlantEconomics([
    row('2026-09-14'), row('2026-09-15'),
  ], [
    tariff({ effective_from: '2026-01-01', effective_to: '2026-09-14' }),
    tariff({ effective_from: '2026-09-15', currency: 'USD' }),
  ], context);
  assert.equal(result.currency, 'mixed');
  assert.equal(result.production_value, null);
  assert.equal(result.estimated_economic_benefit, null);
  assert.equal(result.coverage.mixed_currency, true);
  assert.equal(result.coverage.status, 'partial');
});

test('null conserva resultados desconocidos y marca cobertura parcial', () => {
  const result = calculatePlantEconomics([
    row('2026-09-23', { generation_kwh: null }),
  ], [tariff()], context);
  assert.equal(result.generation_kwh, null);
  assert.equal(result.self_consumption_kwh, null);
  assert.equal(result.production_value, null);
  assert.equal(result.coverage.status, 'partial');
  assert.equal(result.coverage.missing_energy_intervals, 1);
});

test('autoconsumo negativo se limita a cero pero conserva la inconsistencia en cobertura', () => {
  const result = calculatePlantEconomics([
    row('2026-09-23', { generation_kwh: 100, grid_export_kwh: 120 }),
  ], [tariff()], context);
  assert.equal(result.self_consumption_kwh, 0);
  assert.equal(result.self_consumption_savings, 0);
  assert.equal(result.coverage.inconsistent_intervals, 1);
  assert.equal(result.coverage.status, 'partial');
});

test('el cálculo no depende del proveedor HYXi o Growatt', () => {
  const hyxi = calculatePlantEconomics([row('2026-09-23')], [tariff()], context);
  const growatt = calculatePlantEconomics([
    row('2026-09-23', { provider: 'growatt' }),
  ], [tariff()], context);
  assert.equal(growatt.estimated_economic_benefit, hyxi.estimated_economic_benefit);
});

const v1row = (overrides = {}) => row('2026-09-23', {
  generation_kwh: 1000,
  consumption_kwh: 1200,
  grid_import_kwh: 500,
  grid_export_kwh: 300,
  ...overrides,
});
const v1tariff = (overrides = {}) => tariff({
  purchase_energy_rate: 0.9,
  export_energy_rate: 0.45,
  ...overrides,
});

test('CASO 1: sin exportación, todo lo generado es autoconsumo', () => {
  const result = calculatePlantEconomics([v1row({ grid_export_kwh: 0 })],
    [v1tariff({ export_compensation_type: 'none', export_energy_rate: null })], context);
  assert.equal(result.self_consumption_kwh, 1000);
  assert.equal(result.self_consumption_savings, 900);
});

test('CASO 2: exportación sin compensación vale cero y no altera el total', () => {
  const result = calculatePlantEconomics([v1row()],
    [v1tariff({ export_compensation_type: 'none', export_energy_rate: null })], context);
  assert.equal(result.self_consumption_kwh, 700);
  assert.equal(result.self_consumption_savings, 630);
  assert.equal(result.export_compensation_value, 0);
  assert.equal(result.estimated_economic_benefit, 630);
});

test('CASO 3: compensación monetaria suma exportación valorada', () => {
  const result = calculatePlantEconomics([v1row()], [v1tariff()], context);
  assert.equal(result.self_consumption_kwh, 700);
  assert.equal(result.self_consumption_savings, 630);
  assert.equal(result.export_compensation_value, 135);
  assert.equal(result.export_value, 135);
  assert.equal(result.estimated_economic_benefit, 765);
});

test('CASO 4: crédito energético con tarifa estima su valor', () => {
  const result = calculatePlantEconomics([v1row()],
    [v1tariff({ export_compensation_type: 'energy_credit' })], context);
  assert.equal(result.export_credit_kwh, 300);
  assert.equal(result.export_credit_estimated_value, 135);
  assert.equal(result.estimated_economic_benefit, 765);
});

test('CASO 5: crédito energético sin tarifa conserva kWh y deja el total desconocido', () => {
  const result = calculatePlantEconomics([v1row()],
    [v1tariff({ export_compensation_type: 'energy_credit', export_energy_rate: null })], context);
  assert.equal(result.export_credit_kwh, 300);
  assert.equal(result.export_credit_estimated_value, null);
  assert.equal(result.estimated_economic_benefit, null);
});

test('CASO 6: exportación mayor que generación nunca da autoconsumo negativo', () => {
  const result = calculatePlantEconomics(
    [v1row({ generation_kwh: 100, grid_export_kwh: 300 })], [v1tariff()], context);
  assert.ok(result.self_consumption_kwh >= 0);
  assert.equal(result.self_consumption_kwh, 0);
  assert.equal(result.self_consumption_savings, 0);
});

test('CASO 7: datos faltantes conservan null sin convertir a cero', () => {
  const result = calculatePlantEconomics(
    [v1row({ generation_kwh: null, grid_export_kwh: null })], [v1tariff()], context);
  assert.equal(result.self_consumption_kwh, null);
  assert.equal(result.self_consumption_savings, null);
  assert.equal(result.export_credit_estimated_value, null);
});

test('CASO 8: monedas incompatibles no suman beneficios', () => {
  const result = calculatePlantEconomics([
    v1row(),
    { ...v1row(), interval_start: '2026-09-24T16:00:00.000Z' },
  ], [
    v1tariff({ effective_from: '2026-01-01', effective_to: '2026-09-23', currency: 'BOB' }),
    v1tariff({ effective_from: '2026-09-24', currency: 'USD' }),
  ], context);
  assert.equal(result.currency, 'mixed');
  assert.equal(result.estimated_economic_benefit, null);
  assert.equal(result.export_compensation_value, null);
});

test('contrato V1 expone tasas comunes y alias de compensación', () => {
  const result = calculatePlantEconomics([v1row()], [v1tariff()], context);
  assert.equal(result.purchase_energy_rate, 0.9);
  assert.equal(result.export_energy_rate, 0.45);
  const mixed = calculatePlantEconomics([
    v1row(),
    { ...v1row(), interval_start: '2026-09-24T16:00:00.000Z' },
  ], [
    v1tariff({ effective_from: '2026-01-01', effective_to: '2026-09-23' }),
    v1tariff({ effective_from: '2026-09-24', purchase_energy_rate: 1.2 }),
  ], context);
  assert.equal(mixed.purchase_energy_rate, null);
});

// --- Métricas aditivas con cobertura por campo (V1). Legacy intacto. ---
function metricRow(index, values) {
  const hour = String(6 + Math.floor(index / 60)).padStart(2, '0');
  const minute = String(index % 60).padStart(2, '0');
  return row('2026-09-14', {
    interval_start: `2026-09-14T${hour}:${minute}:00.000Z`,
    ...values,
  });
}

function huangDay() {
  // Caso real Casa_Huang 2026-09-14: 158 intervalos, consumo válido en 142.
  const rows = [];
  for (let i = 0; i < 158; i += 1) {
    rows.push(metricRow(i, {
      generation_kwh: 31.7 / 158,
      consumption_kwh: i < 142 ? 8 / 142 : null,
      grid_import_kwh: 1.6 / 158,
      grid_export_kwh: 27.6 / 158,
    }));
  }
  return rows;
}

const approx = (actual, expected) => assert.ok(
  Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);

const fullValues = { generation_kwh: 10, consumption_kwh: 12, grid_import_kwh: 5, grid_export_kwh: 3 };

test('metrics 1: día completo → todo EXACT e igual a legacy', () => {
  const result = calculatePlantEconomics(
    [metricRow(0, fullValues), metricRow(1, fullValues), metricRow(2, fullValues)],
    [tariff()], context);
  for (const [key, value] of Object.entries({
    generation_kwh: 30, consumption_kwh: 36, grid_import_kwh: 15, grid_export_kwh: 9,
  })) {
    assert.deepEqual(result.metrics[key],
      { value, valid_intervals: 3, total_intervals: 3, complete: true, quality: 'EXACT' });
  }
  assert.deepEqual(result.metrics.self_consumption_kwh,
    { value: 21, valid_intervals: 3, total_intervals: 3, complete: true, quality: 'EXACT' });
  approx(result.metrics.self_consumption_savings.value, 16.8);
  assert.equal(result.metrics.self_consumption_savings.quality, 'EXACT');
  approx(result.metrics.export_value.value, 4.5);
  assert.equal(result.metrics.export_value.quality, 'EXACT');
  approx(result.metrics.estimated_economic_benefit.value, 21.3);
  assert.equal(result.metrics.estimated_economic_benefit.quality, 'EXACT');
});

test('metrics 2+3: consumo parcial → PARTIAL observado sin degradar self/savings', () => {
  const result = calculatePlantEconomics(huangDay(), [tariff({ purchase_energy_rate: 0.8 })], context);
  approx(result.metrics.generation_kwh.value, 31.7);
  assert.equal(result.metrics.generation_kwh.quality, 'EXACT');
  approx(result.metrics.consumption_kwh.value, 8);
  assert.deepEqual(
    [result.metrics.consumption_kwh.valid_intervals, result.metrics.consumption_kwh.total_intervals,
      result.metrics.consumption_kwh.complete, result.metrics.consumption_kwh.quality],
    [142, 158, false, 'PARTIAL']);
  assert.equal(result.consumption_kwh, null);
  approx(result.metrics.self_consumption_kwh.value, 4.1);
  assert.equal(result.metrics.self_consumption_kwh.quality, 'EXACT');
  approx(result.self_consumption_kwh, 4.1);
  assert.equal(result.metrics.self_consumption_savings.quality, 'EXACT');
  assert.equal(result.metrics.estimated_economic_benefit.quality, 'EXACT');
  assert.equal(result.coverage.status, 'partial');
  assert.equal(result.coverage.missing_energy_intervals, 16);
});

test('metrics 4: generation parcial + export completa → self PARTIAL', () => {
  const result = calculatePlantEconomics([
    metricRow(0, fullValues),
    metricRow(1, { ...fullValues, generation_kwh: null }),
    metricRow(2, fullValues),
  ], [tariff()], context);
  assert.deepEqual(result.metrics.self_consumption_kwh,
    { value: 14, valid_intervals: 2, total_intervals: 3, complete: false, quality: 'PARTIAL' });
  assert.equal(result.self_consumption_kwh, null);
});

test('metrics 5: export parcial + generation completa → self PARTIAL', () => {
  const result = calculatePlantEconomics([
    metricRow(0, fullValues),
    metricRow(1, { ...fullValues, grid_export_kwh: null }),
    metricRow(2, fullValues),
  ], [tariff()], context);
  assert.deepEqual(result.metrics.self_consumption_kwh,
    { value: 14, valid_intervals: 2, total_intervals: 3, complete: false, quality: 'PARTIAL' });
});

test('metrics 6: sin valores válidos → UNAVAILABLE con value null', () => {
  const result = calculatePlantEconomics(
    [metricRow(0, { ...fullValues, consumption_kwh: null })], [tariff()], context);
  assert.deepEqual(result.metrics.consumption_kwh,
    { value: null, valid_intervals: 0, total_intervals: 1, complete: false, quality: 'UNAVAILABLE' });
  assert.equal(result.consumption_kwh, null);
});

test('metrics 7: tarifa faltante en 1 intervalo → savings PARTIAL observado', () => {
  const result = calculatePlantEconomics([
    metricRow(0, fullValues),
    row('2026-09-15', fullValues),
  ], [tariff({ effective_from: '2026-01-01', effective_to: '2026-09-14' })], context);
  assert.deepEqual(
    [result.metrics.self_consumption_savings.valid_intervals,
      result.metrics.self_consumption_savings.total_intervals,
      result.metrics.self_consumption_savings.quality],
    [1, 2, 'PARTIAL']);
  approx(result.metrics.self_consumption_savings.value, 5.6);
  assert.equal(result.self_consumption_savings, null);
  assert.equal(result.coverage.missing_tariff_intervals, 1);
});

test('metrics 8: compensation none → export_value EXACT 0 aunque falte export', () => {
  const result = calculatePlantEconomics([
    metricRow(0, { ...fullValues, grid_export_kwh: null }),
  ], [tariff({ export_compensation_type: 'none', export_energy_rate: null })], context);
  assert.deepEqual(result.metrics.export_value,
    { value: 0, valid_intervals: 1, total_intervals: 1, complete: true, quality: 'EXACT' });
  assert.equal(result.export_value, 0);
});

test('metrics 9: energy_credit sin tarifa → null/UNAVAILABLE preservados', () => {
  const result = calculatePlantEconomics([metricRow(0, fullValues)], [tariff({
    export_compensation_type: 'energy_credit', export_energy_rate: null,
  })], context);
  assert.equal(result.metrics.export_value.quality, 'UNAVAILABLE');
  assert.equal(result.metrics.export_value.value, null);
  assert.equal(result.export_value, null);
  assert.equal(result.metrics.estimated_economic_benefit.quality, 'UNAVAILABLE');
  assert.equal(result.estimated_economic_benefit, null);
});

test('metrics 10: mixed currency → dinero UNAVAILABLE; energía intacta', () => {
  const result = calculatePlantEconomics([
    metricRow(0, fullValues),
    row('2026-09-15', fullValues),
  ], [
    tariff({ effective_from: '2026-01-01', effective_to: '2026-09-14' }),
    tariff({ effective_from: '2026-09-15', currency: 'USD' }),
  ], context);
  for (const key of ['self_consumption_savings', 'export_value', 'estimated_economic_benefit']) {
    assert.equal(result.metrics[key].quality, 'UNAVAILABLE');
    assert.equal(result.metrics[key].value, null);
  }
  assert.equal(result.metrics.generation_kwh.quality, 'EXACT');
  assert.equal(result.metrics.generation_kwh.value, 20);
  assert.equal(result.currency, 'mixed');
});

test('metrics 11: escalares legacy conservan semántica strictSum', () => {
  const result = calculatePlantEconomics(huangDay(), [tariff({ purchase_energy_rate: 0.8 })], context);
  approx(result.generation_kwh, 31.7);
  assert.equal(result.consumption_kwh, null);
  approx(result.grid_import_kwh, 1.6);
  approx(result.grid_export_kwh, 27.6);
  approx(result.self_consumption_kwh, 4.1);
  approx(result.self_consumption_savings, 3.28);
  approx(result.export_value, 13.8);
  approx(result.estimated_economic_benefit, 17.08);
  assert.deepEqual(Object.keys(result.metrics).sort(), [
    'consumption_kwh', 'estimated_economic_benefit', 'export_value', 'generation_kwh',
    'grid_export_kwh', 'grid_import_kwh', 'self_consumption_kwh', 'self_consumption_savings',
  ]);
});

test('metrics 12: coverage legacy intacto', () => {
  const result = calculatePlantEconomics(huangDay(), [tariff()], context);
  assert.deepEqual(Object.keys(result.coverage).sort(), [
    'complete', 'inconsistent_intervals', 'intervals', 'missing_energy_intervals',
    'missing_tariff_intervals', 'mixed_currency', 'note', 'source_partial_intervals', 'status',
  ]);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.intervals, 158);
  assert.equal(result.coverage.status, 'partial');
});
