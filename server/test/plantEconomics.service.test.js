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

test('autoconsumo agregado negativo no se fabrica como 0: queda null e inconsistente', () => {
  const result = calculatePlantEconomics([
    row('2026-09-23', { generation_kwh: 100, grid_export_kwh: 120 }),
  ], [tariff()], context);
  assert.equal(result.self_consumption_kwh, null);
  assert.equal(result.self_consumption_savings, null);
  assert.equal(result.metrics.self_consumption_kwh.value, null);
  assert.equal(result.metrics.self_consumption_kwh.quality, 'UNAVAILABLE');
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

test('CASO 6: exportación mayor que generación nunca da autoconsumo negativo ni 0 fabricado', () => {
  const result = calculatePlantEconomics(
    [v1row({ generation_kwh: 100, grid_export_kwh: 300 })], [v1tariff()], context);
  assert.equal(result.self_consumption_kwh, null);
  assert.equal(result.self_consumption_savings, null);
  assert.equal(result.coverage.inconsistent_intervals, 1);
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
    'complete', 'inconsistent_intervals', 'intervals', 'meter_suspect', 'missing_energy_intervals',
    'missing_tariff_intervals', 'mixed_currency', 'note', 'period_in_progress',
    'source_partial_intervals', 'status', 'suspect_days',
  ]);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.intervals, 158);
  assert.equal(result.coverage.status, 'partial');
});

// --- Período en curso + medición sospechosa (solo histórico) ---
function dayRow(date, index, values) {
  const hour = String(6 + Math.floor(index / 60)).padStart(2, '0');
  const minute = String(index % 60).padStart(2, '0');
  return row(date, { interval_start: `${date}T${hour}:${minute}:00.000Z`, ...values });
}

const arturoValues = {
  generation_kwh: 35.7 / 152, consumption_kwh: 0, grid_import_kwh: 0, grid_export_kwh: 0,
};
function arturoDay() {
  const rows = [];
  for (let i = 0; i < 152; i += 1) rows.push(dayRow('2026-09-26', i, arturoValues));
  return rows;
}
const arturoTariff = () => tariff({
  effective_from: '2026-09-26', purchase_energy_rate: 1.068,
  export_compensation_type: 'energy_credit', export_energy_rate: null,
});
const dayContext = { period: 'day', start: '2026-09-26', end: '2026-09-27' };
// 2026-09-28 12:00Z = 08:00 La Paz: "hoy" fijado sin flaky.
const afterDay = { ...dayContext, now: Date.UTC(2026, 8, 28, 12, 0) };

test('suspect A: Arturo 26/09 → meter_suspect + suspect_days, derivados SUSPECT', () => {
  const result = calculatePlantEconomics(arturoDay(), [arturoTariff()], afterDay);
  assert.equal(result.coverage.period_in_progress, false);
  assert.equal(result.coverage.meter_suspect, true);
  assert.deepEqual(result.coverage.suspect_days, ['2026-09-26']);
  approx(result.metrics.generation_kwh.value, 35.7);
  assert.equal(result.metrics.generation_kwh.quality, 'EXACT');
  for (const key of ['consumption_kwh', 'grid_import_kwh', 'grid_export_kwh']) {
    assert.equal(result.metrics[key].value, 0);
    assert.equal(result.metrics[key].quality, 'SUSPECT');
  }
  for (const key of ['self_consumption_kwh', 'self_consumption_savings',
    'estimated_economic_benefit']) {
    assert.equal(result.metrics[key].value, null);
    assert.equal(result.metrics[key].quality, 'SUSPECT');
  }
  // Legacy intacto: el ahorro "Bs 38,13" sigue en el escalar, pero metrics lo invalida.
  approx(result.generation_kwh, 35.7);
  assert.equal(result.consumption_kwh, 0);
  approx(result.self_consumption_kwh, 35.7);
  approx(result.self_consumption_savings, 38.1276);
});

test('suspect monetary: export_value también SUSPECT-null', () => {
  const result = calculatePlantEconomics(arturoDay(), [tariff()], afterDay);
  assert.equal(result.metrics.export_value.value, null);
  assert.equal(result.metrics.export_value.quality, 'SUSPECT');
  assert.equal(result.metrics.estimated_economic_benefit.quality, 'SUSPECT');
});

test('suspect none: export_value 0 por regla se preserva EXACT', () => {
  const result = calculatePlantEconomics(arturoDay(),
    [tariff({ export_compensation_type: 'none', export_energy_rate: null })], afterDay);
  assert.equal(result.coverage.meter_suspect, true);
  assert.deepEqual(result.metrics.export_value,
    { value: 0, valid_intervals: 152, total_intervals: 152, complete: true, quality: 'EXACT' });
  assert.equal(result.metrics.self_consumption_savings.quality, 'SUSPECT');
  assert.equal(result.metrics.self_consumption_savings.value, null);
});

test('suspect B/C: zero-export válido con consumo real no es sospechoso', () => {
  const validZeroExport = calculatePlantEconomics([
    dayRow('2026-09-26', 0, fullValues),
    dayRow('2026-09-26', 1, { ...fullValues, grid_export_kwh: 0 }),
  ], [tariff()], afterDay);
  assert.equal(validZeroExport.coverage.meter_suspect, false);
  assert.deepEqual(validZeroExport.coverage.suspect_days, []);
  const selfOnly = calculatePlantEconomics([
    dayRow('2026-09-26', 0, { ...fullValues, grid_import_kwh: 0, grid_export_kwh: 0 }),
  ], [tariff()], afterDay);
  assert.equal(selfOnly.coverage.meter_suspect, false);
});

test('suspect D/E: día sin producción o con métrica incompleta no es sospechoso', () => {
  const idle = calculatePlantEconomics([
    dayRow('2026-09-26', 0, {
      generation_kwh: 0, consumption_kwh: 0, grid_import_kwh: 0, grid_export_kwh: 0,
    }),
  ], [tariff()], afterDay);
  assert.equal(idle.coverage.meter_suspect, false);
  const partial = calculatePlantEconomics([
    dayRow('2026-09-26', 0, { ...arturoValues, consumption_kwh: null }),
  ], [tariff()], afterDay);
  assert.equal(partial.coverage.meter_suspect, false);
});

test('suspect F: Huang no es sospechoso y su self no se modifica', () => {
  const result = calculatePlantEconomics(huangDay(), [tariff()], {
    period: 'month', start: '2026-09-01', end: '2026-10-01', now: Date.UTC(2026, 9, 5, 12, 0),
  });
  assert.equal(result.coverage.meter_suspect, false);
  assert.equal(result.metrics.self_consumption_kwh.quality, 'EXACT');
  approx(result.metrics.self_consumption_kwh.value, 4.1);
});

test('progreso G/H: hoy true, ayer false', () => {
  const todayCtx = { period: 'day', start: '2026-09-26', end: '2026-09-27', now: Date.UTC(2026, 8, 26, 15, 0) };
  const today = calculatePlantEconomics(
    [dayRow('2026-09-26', 0, fullValues), dayRow('2026-09-26', 1, { ...fullValues, consumption_kwh: null })],
    [tariff()], todayCtx);
  assert.equal(today.coverage.period_in_progress, true);
  assert.equal(today.coverage.meter_suspect, false);
  const yesterday = calculatePlantEconomics([dayRow('2026-09-26', 0, fullValues)], [tariff()], {
    period: 'day', start: '2026-09-26', end: '2026-09-27', now: Date.UTC(2026, 8, 27, 11, 0),
  });
  assert.equal(yesterday.coverage.period_in_progress, false);
});

test('progreso I/J: semana actual true, histórica false', () => {
  const current = calculatePlantEconomics([dayRow('2026-09-23', 0, fullValues)], [tariff()], {
    period: 'week', start: '2026-09-21', end: '2026-09-28', now: Date.UTC(2026, 8, 23, 12, 0),
  });
  assert.equal(current.coverage.period_in_progress, true);
  const past = calculatePlantEconomics([dayRow('2026-09-15', 0, fullValues)], [tariff()], {
    period: 'week', start: '2026-09-14', end: '2026-09-21', now: Date.UTC(2026, 8, 28, 12, 0),
  });
  assert.equal(past.coverage.period_in_progress, false);
});

test('suspect K: multi-día aísla el día sospechoso sin ocultarlo', () => {
  const result = calculatePlantEconomics([
    dayRow('2026-09-26', 0, arturoValues),
    dayRow('2026-09-26', 1, arturoValues),
    dayRow('2026-09-27', 0, fullValues),
  ], [tariff()], {
    period: 'week', start: '2026-09-21', end: '2026-09-28', now: Date.UTC(2026, 8, 28, 12, 0),
  });
  assert.equal(result.coverage.meter_suspect, true);
  assert.deepEqual(result.coverage.suspect_days, ['2026-09-26']);
  assert.equal(result.metrics.consumption_kwh.quality, 'SUSPECT');
  assert.equal(result.metrics.consumption_kwh.value, 12);
  assert.equal(result.metrics.self_consumption_kwh.value, null);
  assert.equal(result.metrics.self_consumption_kwh.quality, 'SUSPECT');
});

// --- Autoconsumo agregado (corrige sesgo del clamp por intervalo) ---
const pairRow = (date, index, generation, gridExport) => dayRow(date, index, {
  ...fullValues, generation_kwh: generation, grid_export_kwh: gridExport,
});

test('self A: completo normal usa agregado gen-export', () => {
  const result = calculatePlantEconomics([
    pairRow('2026-09-26', 0, 1, 0.2),
    pairRow('2026-09-26', 1, 1, 0.3),
    pairRow('2026-09-26', 2, 1, 0.4),
  ], [tariff()], { period: 'day', start: '2026-09-26', end: '2026-09-27' });
  approx(result.self_consumption_kwh, 2.1);
  approx(result.metrics.self_consumption_kwh.value, 2.1);
  assert.deepEqual(
    [result.metrics.self_consumption_kwh.valid_intervals,
      result.metrics.self_consumption_kwh.total_intervals,
      result.metrics.self_consumption_kwh.complete,
      result.metrics.self_consumption_kwh.quality],
    [3, 3, true, 'EXACT']);
  approx(result.self_consumption_savings, 1.68);
  assert.equal(result.metrics.self_consumption_savings.quality, 'EXACT');
  approx(result.estimated_economic_benefit, 2.13);
});

test('self B: desfase alterno suma 0 EXACT sin inconsistencia', () => {
  const result = calculatePlantEconomics([
    pairRow('2026-09-26', 0, 0.5, 0.4),
    pairRow('2026-09-26', 1, 0.4, 0.5),
    pairRow('2026-09-26', 2, 0.5, 0.4),
    pairRow('2026-09-26', 3, 0.4, 0.5),
  ], [tariff()], { period: 'day', start: '2026-09-26', end: '2026-09-27' });
  approx(result.self_consumption_kwh, 0);
  approx(result.metrics.self_consumption_kwh.value, 0);
  assert.equal(result.metrics.self_consumption_kwh.quality, 'EXACT');
  assert.equal(result.coverage.inconsistent_intervals, 0);
  assert.equal(result.coverage.status, 'available');
});

test('self C: Huang real da 4.1 EXACT sin warning de inconsistencia', () => {
  const result = calculatePlantEconomics(huangDay(), [tariff({ purchase_energy_rate: 0.8 })], {
    period: 'month', start: '2026-09-01', end: '2026-10-01', now: Date.UTC(2026, 9, 5, 12, 0),
  });
  approx(result.self_consumption_kwh, 4.1);
  approx(result.metrics.self_consumption_kwh.value, 4.1);
  assert.equal(result.metrics.self_consumption_kwh.quality, 'EXACT');
  assert.equal(result.coverage.inconsistent_intervals, 0);
  assert.equal(result.coverage.meter_suspect, false);
  approx(result.self_consumption_savings, 3.28);
});

test('self D: agregado export>generation → null + inconsistente, sin 0 fabricado', () => {
  const result = calculatePlantEconomics(
    [pairRow('2026-09-26', 0, 10, 11)], [tariff()],
    { period: 'day', start: '2026-09-26', end: '2026-09-27' });
  assert.equal(result.self_consumption_kwh, null);
  assert.equal(result.metrics.self_consumption_kwh.value, null);
  assert.equal(result.metrics.self_consumption_kwh.quality, 'UNAVAILABLE');
  assert.equal(result.coverage.inconsistent_intervals, 1);
  assert.equal(result.coverage.status, 'partial');
  assert.equal(result.self_consumption_savings, null);
  assert.equal(result.estimated_economic_benefit, null);
});

test('self E/F/G: parcial usa pares válidos con clamp conservador', () => {
  const genMissing = calculatePlantEconomics([
    pairRow('2026-09-26', 0, 10, 3),
    dayRow('2026-09-26', 1, { ...fullValues, generation_kwh: null }),
  ], [tariff()], { period: 'day', start: '2026-09-26', end: '2026-09-27' });
  assert.deepEqual(genMissing.metrics.self_consumption_kwh,
    { value: 7, valid_intervals: 1, total_intervals: 2, complete: false, quality: 'PARTIAL' });
  assert.equal(genMissing.self_consumption_kwh, null);
  const expMissing = calculatePlantEconomics([
    pairRow('2026-09-26', 0, 10, 3),
    dayRow('2026-09-26', 1, { ...fullValues, grid_export_kwh: null }),
  ], [tariff()], { period: 'day', start: '2026-09-26', end: '2026-09-27' });
  assert.deepEqual(expMissing.metrics.self_consumption_kwh,
    { value: 7, valid_intervals: 1, total_intervals: 2, complete: false, quality: 'PARTIAL' });
  const bothMissing = calculatePlantEconomics([
    dayRow('2026-09-26', 0, { ...fullValues, generation_kwh: null }),
    dayRow('2026-09-26', 1, { ...fullValues, grid_export_kwh: null }),
    pairRow('2026-09-26', 2, 10, 3),
  ], [tariff()], { period: 'day', start: '2026-09-26', end: '2026-09-27' });
  assert.deepEqual(bothMissing.metrics.self_consumption_kwh,
    { value: 7, valid_intervals: 1, total_intervals: 3, complete: false, quality: 'PARTIAL' });
});

test('self H/I: cons o imp parcial no afectan self con gen/exp completos', () => {
  const ctx = { period: 'day', start: '2026-09-26', end: '2026-09-27' };
  const consPartial = calculatePlantEconomics([
    pairRow('2026-09-26', 0, 10, 3),
    dayRow('2026-09-26', 1, { generation_kwh: 10, grid_export_kwh: 3, consumption_kwh: null, grid_import_kwh: 5 }),
  ], [tariff()], ctx);
  assert.equal(consPartial.self_consumption_kwh, 14);
  assert.equal(consPartial.metrics.self_consumption_kwh.quality, 'EXACT');
  const impPartial = calculatePlantEconomics([
    pairRow('2026-09-26', 0, 10, 3),
    dayRow('2026-09-26', 1, { generation_kwh: 10, grid_export_kwh: 3, consumption_kwh: 12, grid_import_kwh: null }),
  ], [tariff()], ctx);
  assert.equal(impPartial.self_consumption_kwh, 14);
  assert.equal(impPartial.metrics.self_consumption_kwh.quality, 'EXACT');
});

test('self J: Arturo sigue protegido (SUSPECT anula el agregado 35.7)', () => {
  const result = calculatePlantEconomics(arturoDay(), [arturoTariff()], afterDay);
  assert.equal(result.coverage.meter_suspect, true);
  approx(result.self_consumption_kwh, 35.7);
  assert.equal(result.metrics.self_consumption_kwh.value, null);
  assert.equal(result.metrics.self_consumption_kwh.quality, 'SUSPECT');
  assert.equal(result.metrics.self_consumption_savings.value, null);
  assert.equal(result.metrics.estimated_economic_benefit.value, null);
});

test('self K: zero-export válido da self=gen EXACT', () => {
  const result = calculatePlantEconomics([
    pairRow('2026-09-26', 0, 10, 0),
    pairRow('2026-09-26', 1, 10, 0),
  ], [tariff()], { period: 'day', start: '2026-09-26', end: '2026-09-27' });
  assert.equal(result.coverage.meter_suspect, false);
  assert.equal(result.self_consumption_kwh, 20);
  assert.equal(result.metrics.self_consumption_kwh.quality, 'EXACT');
});

test('self L/M: savings usa self corregido y respeta cada tarifa', () => {

  const uniform = calculatePlantEconomics([
    pairRow('2026-09-26', 0, 1, 0.2),
    pairRow('2026-09-26', 1, 1, 0.3),
    pairRow('2026-09-26', 2, 1, 0.4),
  ], [tariff({ purchase_energy_rate: 0.8 })],
  { period: 'day', start: '2026-09-26', end: '2026-09-27' });
  approx(uniform.self_consumption_savings, 1.68);
  const multi = calculatePlantEconomics([
    pairRow('2026-09-26', 0, 10, 2),
    row('2026-09-27', { generation_kwh: 10, grid_export_kwh: 2, consumption_kwh: 12, grid_import_kwh: 5 }),
  ], [
    tariff({ effective_from: '2026-01-01', effective_to: '2026-09-26', purchase_energy_rate: 0.5, export_compensation_type: 'none', export_energy_rate: null }),
    tariff({ effective_from: '2026-09-27', purchase_energy_rate: 1, export_compensation_type: 'none', export_energy_rate: null }),
  ], { period: 'week', start: '2026-09-21', end: '2026-09-28' });
  approx(multi.self_consumption_savings, 12);
  assert.equal(multi.metrics.self_consumption_savings.quality, 'EXACT');
  assert.ok(Math.abs(multi.self_consumption_savings - 8) > 1e-9);
  assert.ok(Math.abs(multi.self_consumption_savings - 16) > 1e-9);
});

// --- meter_suspect con generación parcial (caso Romao) ---
const romaoRow = (index, generation) => dayRow('2026-09-26', index, {
  generation_kwh: generation, consumption_kwh: 0, grid_import_kwh: 0, grid_export_kwh: 0,
});
const romaoCtx = { period: 'day', start: '2026-09-26', end: '2026-09-27', now: Date.UTC(2026, 8, 28, 12, 0) };

test('romao B: gen parcial + red/carga completas en 0 → SUSPECT', () => {
  const result = calculatePlantEconomics(
    [romaoRow(0, 10), romaoRow(1, null), romaoRow(2, 8)], [tariff()], romaoCtx);
  assert.equal(result.coverage.meter_suspect, true);
  assert.deepEqual(result.coverage.suspect_days, ['2026-09-26']);
  assert.equal(result.metrics.generation_kwh.quality, 'PARTIAL');
  approx(result.metrics.generation_kwh.value, 18);
  for (const key of ['consumption_kwh', 'grid_import_kwh', 'grid_export_kwh']) {
    assert.equal(result.metrics[key].value, 0);
    assert.equal(result.metrics[key].quality, 'SUSPECT');
  }
  assert.equal(result.metrics.self_consumption_kwh.value, null);
  assert.equal(result.metrics.self_consumption_kwh.quality, 'SUSPECT');
  assert.equal(result.metrics.self_consumption_savings.value, null);
  assert.equal(result.metrics.estimated_economic_benefit.value, null);
});

test('romao C: gen parcial + red/carga viva → NO SUSPECT', () => {
  const result = calculatePlantEconomics([
    dayRow('2026-09-26', 0, { generation_kwh: 1, consumption_kwh: 0.5, grid_import_kwh: 0, grid_export_kwh: 0.5 }),
    dayRow('2026-09-26', 1, { generation_kwh: null, consumption_kwh: 0.4, grid_import_kwh: 0.1, grid_export_kwh: 0.5 }),
    dayRow('2026-09-26', 2, { generation_kwh: 2, consumption_kwh: 0.6, grid_import_kwh: 0, grid_export_kwh: 1.4 }),
  ], [tariff()], romaoCtx);
  assert.equal(result.coverage.meter_suspect, false);
});

test('romao D/E/F: canal red/carga incompleto → NO SUSPECT', () => {
  const ctx = romaoCtx;
  const consNull = calculatePlantEconomics([
    romaoRow(0, 10), dayRow('2026-09-26', 1, { generation_kwh: 8, consumption_kwh: null, grid_import_kwh: 0, grid_export_kwh: 0 }),
  ], [tariff()], ctx);
  assert.equal(consNull.coverage.meter_suspect, false);
  const impNull = calculatePlantEconomics([
    romaoRow(0, 10), dayRow('2026-09-26', 1, { generation_kwh: 8, consumption_kwh: 0, grid_import_kwh: null, grid_export_kwh: 0 }),
  ], [tariff()], ctx);
  assert.equal(impNull.coverage.meter_suspect, false);
  const expNull = calculatePlantEconomics([
    romaoRow(0, 10), dayRow('2026-09-26', 1, { generation_kwh: 8, consumption_kwh: 0, grid_import_kwh: 0, grid_export_kwh: null }),
  ], [tariff()], ctx);
  assert.equal(expNull.coverage.meter_suspect, false);
});

test('romao G: generación observada 0 → NO SUSPECT', () => {
  const result = calculatePlantEconomics([
    romaoRow(0, 0), romaoRow(1, 0),
  ], [tariff()], romaoCtx);
  assert.equal(result.coverage.meter_suspect, false);
});

test('romao I: multi-día aísla solo el día Romao-like', () => {
  const result = calculatePlantEconomics([
    romaoRow(0, 10),
    dayRow('2026-09-26', 1, { generation_kwh: null, consumption_kwh: 0, grid_import_kwh: 0, grid_export_kwh: 0 }),
    dayRow('2026-09-27', 0, fullValues),
  ], [tariff()], {
    period: 'week', start: '2026-09-21', end: '2026-09-28', now: Date.UTC(2026, 8, 28, 12, 0),
  });
  assert.equal(result.coverage.meter_suspect, true);
  assert.deepEqual(result.coverage.suspect_days, ['2026-09-26']);
});
