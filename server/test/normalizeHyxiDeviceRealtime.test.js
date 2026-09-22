import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHyxiDeviceRealtime } from '../src/providers/hyxi/normalizeHyxiDeviceRealtime.js';

function payload(pairs) {
  return pairs.map(([dataKey, dataValue]) => ({ dataKey, dataValue }));
}

test('ph1Loadp+ph2Loadp+ph3Loadp se suman como load_power', () => {
  const normalized = normalizeHyxiDeviceRealtime(payload([
    ['ph1Loadp', '100'], ['ph2Loadp', '200'], ['ph3Loadp', '300'],
  ]), 'device-1');
  assert.equal(normalized.load_power, 600);
});

test('load_power queda null si las fases no existen o son inválidas', () => {
  const absent = normalizeHyxiDeviceRealtime(payload([
    ['ppv', '0.0'], ['acP', '0.0'], ['gridP', '-0.775'],
  ]), 'device-2');
  assert.equal(absent.load_power, null);

  const invalid = normalizeHyxiDeviceRealtime(payload([
    ['ph1Loadp', 'not-a-number'], ['ph2Loadp', ''], ['ph3Loadp', null],
  ]), 'device-3');
  assert.equal(invalid.load_power, null);
});

test('suma solo las fases presentes (monofásico)', () => {
  const normalized = normalizeHyxiDeviceRealtime(payload([
    ['ph1Loadp', '275.0'],
  ]), 'device-4');
  assert.equal(normalized.load_power, 275);
});

test('mantiene ppv/ac_power/gridP/batería sin conversión', () => {
  const normalized = normalizeHyxiDeviceRealtime(payload([
    ['ppv', '3200'], ['acP', '3120.5'], ['gridP', '-0.775'],
    ['pbat', '400'], ['batSoc', '87'],
    ['ph1Loadp', '100'], ['ph2Loadp', '0'], ['ph3Loadp', '494'],
  ]), 'device-5');
  assert.equal(normalized.pv_power, 3200);
  assert.equal(normalized.ac_power, 3120.5);
  assert.equal(normalized.grid_power, -0.775);
  assert.equal(normalized.battery_power, 400);
  assert.equal(normalized.battery_soc, 87);
  assert.equal(normalized.load_power, 594);
});