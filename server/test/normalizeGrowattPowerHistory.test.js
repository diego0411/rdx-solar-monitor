import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGrowattPowerHistory } from '../src/providers/growatt/normalizeGrowattPowerHistory.js';

test('normaliza métricas, conserva ceros y acepta lost=true', () => {
  const raw = {
    time: '2026-09-14 10:05:00', lost: true, ppv: '0', pacToLocalLoad: 125,
    pacToUserTotal: null, pacToGridTotal: '3.5', chargePowerOfBattery: 0,
    disChargePowerOfBattery: 'invalid',
  };
  const [point] = normalizeGrowattPowerHistory({ data: { datas: [raw] } });

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
    { time: '2026-09-14 10:10:00', ppv: null, pacToLocalLoad: '' },
    { time: 'invalid', ppv: 10 },
    { time: '2026-09-14 10:15:00', ppv: 20 },
  ] });

  assert.equal(points.length, 1);
  assert.equal(points[0].generation_power_w, 20);
});
