import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePlantLoadPower,
  HYXI_LOAD_POWER_MAX_AGE_MINUTES,
} from '../src/services/plantLoadPower.service.js';

const now = Date.parse('2026-09-20T23:30:00.000Z');
const point = (minutesAgo, value = 344) => ({
  interval_start: new Date(now - minutesAgo * 60000).toISOString(),
  consumption_power_w: value,
  timezone: 'America/La_Paz',
});

test('HYXI_LOAD_POWER_MAX_AGE_MINUTES es 60', () => {
  assert.equal(HYXI_LOAD_POWER_MAX_AGE_MINUTES, 60);
});

test('realtime load_power fresh tiene prioridad sobre el fallback', () => {
  const result = resolvePlantLoadPower({
    deviceLoadPower: 42,
    latestConsumption: point(5),
    provider: 'hyxi',
    now,
  });
  assert.deepEqual(result, { load_power: 42, load_power_at: null });
});

test('fallback HYXi de 30 min es aceptado', () => {
  const result = resolvePlantLoadPower({
    deviceLoadPower: null,
    latestConsumption: point(30),
    provider: 'hyxi',
    now,
  });
  assert.deepEqual(result, {
    load_power: 344,
    load_power_at: point(30).interval_start,
  });
});

test('fallback HYXi de 50 min es aceptado', () => {
  const result = resolvePlantLoadPower({
    deviceLoadPower: null,
    latestConsumption: point(50),
    provider: 'hyxi',
    now,
  });
  assert.deepEqual(result, {
    load_power: 344,
    load_power_at: point(50).interval_start,
  });
});

test('fallback HYXi de exactamente 60 min es aceptado', () => {
  const result = resolvePlantLoadPower({
    deviceLoadPower: null,
    latestConsumption: point(60),
    provider: 'hyxi',
    now,
  });
  assert.deepEqual(result, {
    load_power: 344,
    load_power_at: point(60).interval_start,
  });
});

test('fallback HYXi de mas de 60 min devuelve null', () => {
  const result = resolvePlantLoadPower({
    deviceLoadPower: null,
    latestConsumption: point(61),
    provider: 'hyxi',
    now,
  });
  assert.deepEqual(result, { load_power: null, load_power_at: null });
});

test('consumePower=0 es válido y se conserva', () => {
  const result = resolvePlantLoadPower({
    deviceLoadPower: null,
    latestConsumption: point(10, 0),
    provider: 'hyxi',
    now,
  });
  assert.deepEqual(result, {
    load_power: 0,
    load_power_at: point(10, 0).interval_start,
  });
});

test('fallback ausente o null devuelve null', () => {
  assert.deepEqual(resolvePlantLoadPower({
    deviceLoadPower: null,
    latestConsumption: null,
    provider: 'hyxi',
    now,
  }), { load_power: null, load_power_at: null });

  assert.deepEqual(resolvePlantLoadPower({
    deviceLoadPower: null,
    latestConsumption: { interval_start: point(5).interval_start, consumption_power_w: null },
    provider: 'hyxi',
    now,
  }), { load_power: null, load_power_at: null });
});

test('el fallback no modifica data_status ni data_age_minutes', () => {
  const result = resolvePlantLoadPower({
    deviceLoadPower: null,
    latestConsumption: point(30),
    provider: 'hyxi',
    now,
  });
  assert.deepEqual(Object.keys(result).sort(), ['load_power', 'load_power_at']);
  assert.equal('data_status' in result, false);
  assert.equal('data_age_minutes' in result, false);
});

test('Growatt no usa este fallback', () => {
  const result = resolvePlantLoadPower({
    deviceLoadPower: null,
    latestConsumption: point(5),
    provider: 'growatt',
    now,
  });
  assert.deepEqual(result, { load_power: null, load_power_at: null });
});

test('el resultado no altera pv_power/ac_power/grid_power', () => {
  const result = resolvePlantLoadPower({
    deviceLoadPower: null,
    latestConsumption: point(5),
    provider: 'hyxi',
    now,
  });
  assert.equal(result.load_power, 344);
  assert.equal('pv_power' in result, false);
  assert.equal('ac_power' in result, false);
  assert.equal('grid_power' in result, false);
});