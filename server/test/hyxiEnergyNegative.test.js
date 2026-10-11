import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeHyxiEnergyHistory } from '../src/providers/hyxi/normalizeHyxiEnergyHistory.js';
import { normalizeHyxiPowerHistory } from '../src/providers/hyxi/normalizeHyxiPowerHistory.js';
import { energyFromPower, mergeHyxiEnergyRows } from '../src/services/hyxiEnergyHistory.service.js';
import { calculatePlantEconomics } from '../src/services/plantEconomics.service.js';

// ECO-03B: energía HYXi negativa inválida → null (nunca 0); potencia con
// signo intacta; el merge preserva lo válido; la economía no monetiza.

const stamp = Date.parse('2026-10-10T12:00:00.000Z') / 1000;
const energyPayload = values => ({
  data: {
    timeZone: 'America/La_Paz',
    timePoint: [stamp],
    yield: [values.generation], consume: [values.consumption],
    charged: [values.charge], discharged: [values.discharge],
    buyYield: [values.import], sellYield: [values.export],
  },
});

test('1: energía positiva y cero se conservan', () => {
  const [point] = normalizeHyxiEnergyHistory(energyPayload(
    { generation: 5, consumption: 0, charge: 1.5, discharge: 0, import: 2, export: 0 })).points;
  assert.equal(point.generation_kwh, 5);
  assert.equal(point.consumption_kwh, 0);
  assert.equal(point.battery_charge_kwh, 1.5);
  assert.equal(point.grid_import_kwh, 2);
  assert.equal(point.grid_export_kwh, 0);
});

test('2: energía negativa en los seis campos → null, raw conserva original', () => {
  const [point] = normalizeHyxiEnergyHistory(energyPayload(
    { generation: -5, consumption: -1, charge: -0.5, discharge: -2, import: -3, export: -4 })).points;
  assert.equal(point.generation_kwh, null);
  assert.equal(point.consumption_kwh, null);
  assert.equal(point.battery_charge_kwh, null);
  assert.equal(point.battery_discharge_kwh, null);
  assert.equal(point.grid_import_kwh, null);
  assert.equal(point.grid_export_kwh, null);
  assert.equal(point.raw_data.yield, -5);
});

test('3: campo ausente → null', () => {
  const [point] = normalizeHyxiEnergyHistory(energyPayload({ generation: 5 })).points;
  assert.equal(point.generation_kwh, 5);
  assert.equal(point.consumption_kwh, null);
});

test('4: potencia instantánea negativa válida intacta', () => {
  const [point] = normalizeHyxiPowerHistory({ data: {
    timeZone: 'America/La_Paz', timePoint: [stamp], yieldPower: [100], consumePower: [-50],
  } });
  assert.equal(point.generation_power_w, 100);
  assert.equal(point.consumption_power_w, -50);
});

test('5: energyFromPower: positiva, cero, negativa, ausente', () => {
  assert.equal(energyFromPower(1000, 0.25), 0.25);
  assert.equal(energyFromPower(0, 0.25), 0);
  assert.equal(energyFromPower(-100, 0.25), null);
  assert.equal(energyFromPower(null, 0.25), null);
  assert.equal(energyFromPower('nope', 0.25), null);
});

test('6: re-sync con nulo (negativo rechazado) preserva histórico válido', () => {
  const existing = [{ interval_start: '2026-10-10T12:00:00.000Z', generation_kwh: 5,
    consumption_kwh: 3, grid_import_kwh: 1, grid_export_kwh: 2,
    battery_charge_kwh: null, battery_discharge_kwh: null, raw_data: {} }];
  const candidate = [{ interval_start: '2026-10-10T12:00:00.000Z', generation_kwh: null,
    consumption_kwh: 3, grid_import_kwh: 1, grid_export_kwh: 2,
    battery_charge_kwh: null, battery_discharge_kwh: null, raw_data: {} }];
  const { rows, stats } = mergeHyxiEnergyRows(existing, candidate);
  assert.equal(rows[0].generation_kwh, 5);
  assert.ok(stats.preserved >= 1);
});

test('7: medición directa válida conserva prioridad sobre derivado', () => {
  const existing = [{ interval_start: '2026-10-10T12:00:00.000Z', generation_kwh: null,
    consumption_kwh: null, grid_import_kwh: null, grid_export_kwh: null,
    battery_charge_kwh: null, battery_discharge_kwh: null, raw_data: {} }];
  const candidate = [{ interval_start: '2026-10-10T12:00:00.000Z', generation_kwh: 4,
    consumption_kwh: 2, grid_import_kwh: 1, grid_export_kwh: 1,
    battery_charge_kwh: null, battery_discharge_kwh: null,
    raw_data: { derived_from: 'plant_power_intervals' } }];
  const { rows } = mergeHyxiEnergyRows(existing, candidate);
  assert.equal(rows[0].generation_kwh, 4);
});

test('8: fila nulada no genera dinero negativo (cobertura parcial honesta)', () => {
  const summary = calculatePlantEconomics(
    [{ interval_start: '2026-10-10T12:00:00.000Z', timezone: 'America/La_Paz', provider: 'hyxi',
       updated_at: '2026-10-10T12:05:00.000Z', raw_data: {},
       generation_kwh: null, consumption_kwh: 10, grid_import_kwh: 0, grid_export_kwh: 0 }],
    [{ effective_from: '2026-10-01', effective_to: null, purchase_energy_rate: 1.5,
       export_energy_rate: null, currency: 'BOB', export_compensation_type: 'none' }],
    { period: 'day', start: '2026-10-10', end: '2026-10-11' });
  assert.equal(summary.production_value, null);
  assert.equal(summary.coverage.status, 'partial');
  assert.ok(![summary.production_value, summary.self_consumption_savings,
    summary.estimated_economic_benefit].some(value => typeof value === 'number' && value < 0));
});
