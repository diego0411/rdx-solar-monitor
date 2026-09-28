import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGrowattPowerHistory } from '../src/providers/growatt/normalizeGrowattPowerHistory.js';

test('normaliza métricas, conserva ceros y acepta lost=true', () => {
  const raw = {
    time: '2026-09-14 10:05:00', lost: true, ppv: '15', pac: '0', pacToLocalLoad: 125,
    pacToUserTotal: null, pacToGridTotal: '3.5', chargePowerOfBattery: 0,
    disChargePowerOfBattery: 'invalid',
  };
  const [point] = normalizeGrowattPowerHistory({ data: { datas: [raw] } }, 'America/La_Paz');

  assert.deepEqual(point, {
    interval_start: '2026-09-14T14:05:00.000Z',
    generation_power_w: 0,
    consumption_power_w: 125,
    grid_import_power_w: null,
    grid_export_power_w: 3.5,
    battery_charge_power_w: 0,
    battery_discharge_power_w: null,
    raw_data: raw,
  });
});

test('descarta puntos sin timestamp válido o sin ninguna métrica numérica', () => {
  const points = normalizeGrowattPowerHistory({ data: [
    { time: '2026-09-14 10:10:00', pac: null, pacToLocalLoad: '' },
    { time: 'invalid', pac: 10 },
    { time: '2026-09-14 10:15:00', ppv: 25, pac: 20 },
  ] });

  assert.equal(points.length, 1);
  assert.equal(points[0].generation_power_w, 20);
  assert.equal(points[0].raw_data.ppv, 25);
});

test('usa potencia AC para generacion y mantiene el balance del punto Growatt', () => {
  const [point] = normalizeGrowattPowerHistory({ data: [{
    time: '2026-09-23 12:30:07',
    ppv: 5419.60009765625,
    pac: 5193.7998046875,
    pacToLocalLoad: 1373.300048828125,
    pacToUserTotal: 0,
    pacToGridTotal: 3820.5,
  }] }, 'America/La_Paz');

  assert.equal(point.generation_power_w, 5193.7998046875);
  assert.equal(point.consumption_power_w, 1373.300048828125);
  assert.equal(point.grid_import_power_w, 0);
  assert.equal(point.grid_export_power_w, 3820.5);
  assert.ok(Math.abs(
    point.generation_power_w + point.grid_import_power_w
      - point.consumption_power_w - point.grid_export_power_w,
  ) < 1);
  assert.equal(point.raw_data.ppv, 5419.60009765625);
});

test('no usa ppv como fallback cuando falta pac', () => {
  const [point] = normalizeGrowattPowerHistory({ data: [{
    time: '2026-09-23 12:30:07', ppv: 5419.6, pacToLocalLoad: 1373.3,
  }] }, 'America/La_Paz');

  assert.equal(point.generation_power_w, null);
  assert.equal(point.raw_data.ppv, 5419.6);
});

const exportCase = (overrides = {}) => normalizeGrowattPowerHistory({ data: [{
  time: '2026-09-27 12:00:00',
  pac: 1399.7,
  pacToLocalLoad: 18.7,
  pacToUserTotal: 0,
  pacToGridTotal: 1381,
  ...overrides,
}] }, 'America/La_Paz')[0];

test('export A: muestra normal balanceada no se corrige', () => {
  const point = exportCase();
  assert.equal(point.grid_export_power_w, 1381);
  assert.equal(point.generation_power_w, 1399.7);
});

test('export B: glitch Arturo se corrige a pac-load+import', () => {
  const point = exportCase({ pac: 2250.7, pacToLocalLoad: 2226.6, pacToGridTotal: 4477.3 });
  assert.ok(Math.abs(point.grid_export_power_w - 24.1) < 1e-6);
  assert.equal(point.generation_power_w, 2250.7);
  assert.equal(point.consumption_power_w, 2226.6);
  assert.equal(point.grid_import_power_w, 0);
});

test('export C: otro glitch con load pequeño se corrige', () => {
  const point = exportCase({ pac: 5942.3, pacToLocalLoad: 42.4, pacToGridTotal: 5984.7 });
  assert.ok(Math.abs(point.grid_export_power_w - 5899.9) < 1e-6);
});

test('export D: importación sana balanceada no se toca', () => {
  const point = exportCase({
    pac: 1000, pacToLocalLoad: 1500, pacToUserTotal: 500, pacToGridTotal: 0,
  });
  assert.equal(point.grid_export_power_w, 0);
  assert.equal(point.grid_import_power_w, 500);
});

test('export E: expected negativo (dropout pac) no se corrige ni clamplea', () => {
  const point = exportCase({
    pac: 0, pacToLocalLoad: 4872.2, pacToUserTotal: 0, pacToGridTotal: 4872.2,
  });
  assert.equal(point.grid_export_power_w, 4872.2);
});

test('export F: import significativo bloquea la corrección', () => {
  // pac+load=3300 coincide con reported, pero import=500 lo invalida.
  const point = exportCase({
    pac: 3000, pacToLocalLoad: 300, pacToUserTotal: 500, pacToGridTotal: 3300,
  });
  assert.equal(point.grid_export_power_w, 3300);
});

test('export G: diferencia pequeña dentro del balance no se corrige', () => {
  const point = exportCase({ pacToGridTotal: 1390 });
  assert.equal(point.grid_export_power_w, 1390);
});

test('export H: valores no numéricos preservan comportamiento', () => {
  const point = exportCase({ pacToGridTotal: null });
  assert.equal(point.grid_export_power_w, null);
  const noLoad = exportCase({ pacToLocalLoad: undefined, pacToGridTotal: 4477.3 });
  assert.equal(noLoad.grid_export_power_w, 4477.3);
});

test('export I/J: generation sigue pac y ppv no interviene', () => {
  const point = exportCase({ ppv: 9999, pac: 2250.7, pacToLocalLoad: 2226.6, pacToGridTotal: 4477.3 });
  assert.equal(point.generation_power_w, 2250.7);
  assert.equal(point.raw_data.ppv, 9999);
});
