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

test('autoconsumo negativo se reporta como inconsistencia y nunca como valor negativo', () => {
  const result = calculatePlantEconomics([
    row('2026-09-23', { generation_kwh: 100, grid_export_kwh: 120 }),
  ], [tariff()], context);
  assert.equal(result.self_consumption_kwh, null);
  assert.equal(result.self_consumption_savings, null);
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
