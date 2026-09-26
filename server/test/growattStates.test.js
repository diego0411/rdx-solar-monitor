import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGrowattTimestamp,
  isGrowattFault,
  communicationStatus,
  operationalStatus,
  growattDeviceState,
  isSameCalendarDay,
} from '../src/providers/growatt/growattStates.js';

const NOW = new Date('2026-09-15T12:00:00.000Z').getTime();

function freshRow(overrides = {}, raw = {}) {
  return {
    collected_at: '2026-09-15T11:59:00.000Z',
    raw_data: { status: 1, statusText: 'Normal', lost: false, ...raw },
    ...overrides,
  };
}

test('parseGrowattTimestamp interpreta wall-time con la timezone de la planta', () => {
  assert.equal(
    parseGrowattTimestamp('2026-09-15 10:00:00', 'GMT-4'),
    '2026-09-15T14:00:00.000Z',
  );
  assert.equal(
    parseGrowattTimestamp('2026-09-21 00:57:30', 'GMT+4'),
    '2026-09-20T20:57:30.000Z',
  );
  assert.equal(
    parseGrowattTimestamp('2026-09-15 10:00:00', 'America/La_Paz'),
    '2026-09-15T14:00:00.000Z',
  );
  assert.equal(
    parseGrowattTimestamp('2026-09-15 10:00:00', 'GMT-04:00'),
    parseGrowattTimestamp('2026-09-15 10:00:00', 'GMT-4'),
  );
});

test('parseGrowattTimestamp cae a UTC sin timezone válida', () => {
  assert.equal(parseGrowattTimestamp('2026-09-15 10:00:00', undefined), '2026-09-15T10:00:00.000Z');
  assert.equal(parseGrowattTimestamp('2026-09-15 10:00:00', ''), '2026-09-15T10:00:00.000Z');
  assert.equal(parseGrowattTimestamp('2026-09-15 10:00:00', 'UTC'), '2026-09-15T10:00:00.000Z');
});

test('parseGrowattTimestamp rechaza valores inválidos y calendarios inexistentes', () => {
  assert.equal(parseGrowattTimestamp(null, 'GMT-4'), null);
  assert.equal(parseGrowattTimestamp('no es una fecha', 'GMT-4'), null);
  assert.equal(parseGrowattTimestamp('2026-13-40 10:00:00', 'GMT-4'), null);
  assert.equal(parseGrowattTimestamp('2026-02-30 00:00:00', 'GMT-4'), null);
  assert.equal(parseGrowattTimestamp('2026-09-15T10:00:00', 'GMT-4'), null);
  assert.equal(parseGrowattTimestamp('2026-09-15 10:00', 'GMT-4'), null);
});

test('parseGrowattTimestamp descarta timestamps demasiado futuros', () => {
  const in11Minutes = new Date(NOW + 11 * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19);
  assert.equal(parseGrowattTimestamp(in11Minutes, 'UTC', NOW), null);

  const in5Minutes = new Date(NOW + 5 * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19);
  const expected = new Date(Math.trunc((NOW + 5 * 60 * 1000) / 1000) * 1000).toISOString();
  assert.equal(parseGrowattTimestamp(in5Minutes, 'UTC', NOW), expected);
});

test('isGrowattFault unifica la regla de incidencia Growatt', () => {
  for (const raw of [
    { status: 3 },
    { status: '3' },
    { status: ' Fault ' },
    { status: 1, faultType: 12 },
    { status: '1', faultType: '12' },
    { status: 0, warnCode: 8 },
    { status: 1, warnCode: '8' },
  ]) {
    assert.equal(isGrowattFault(raw), true, JSON.stringify(raw));
  }

  for (const raw of [
    null,
    [],
    {},
    { status: 1 },
    { status: 2 },
    { status: 1, faultType: 0, warnCode: 0 },
    { status: 'invalid', faultType: 'invalid', warnCode: false },
  ]) {
    assert.equal(isGrowattFault(raw), false, JSON.stringify(raw));
  }
});

test('communicationStatus: solo fresh + estado normal sin lost es connected', () => {
  assert.equal(communicationStatus(freshRow(), NOW), 'connected');
  assert.equal(communicationStatus(freshRow({}, { lost: true }), NOW), 'unknown');
  assert.equal(communicationStatus(freshRow({ collected_at: '2026-09-14T11:59:00.000Z' }), NOW), 'unknown');
  assert.equal(communicationStatus(freshRow({}, { status: 2 }), NOW), 'unknown');
});

test('communicationStatus: sin timestamp solo disconnected si lost=true', () => {
  assert.equal(communicationStatus({ raw_data: { lost: true } }, NOW), 'disconnected');
  assert.equal(communicationStatus({ raw_data: { lost: false } }, NOW), 'unknown');
  assert.equal(communicationStatus({ raw_data: {} }, NOW), 'unknown');
});

test('communicationStatus usa columnas raw cuando raw_data no está disponible', () => {
  assert.equal(communicationStatus({
    collected_at: '2026-09-15T11:59:00.000Z',
    raw_status: 1,
    raw_lost: false,
  }, NOW), 'connected');
});

test('operationalStatus: producing/idle solo con telemetría fresca', () => {
  assert.equal(operationalStatus(freshRow({ ac_power: 500 }), NOW), 'producing');
  assert.equal(operationalStatus(freshRow({ ac_power: 0 }), NOW), 'idle');
  assert.equal(operationalStatus(freshRow({ ac_power: 'x' }), NOW), 'unknown');
  assert.equal(operationalStatus(freshRow({ collected_at: '2026-09-14T11:59:00.000Z', ac_power: 500 }), NOW), 'unknown');
  assert.equal(operationalStatus({ ac_power: 500 }, NOW), 'unavailable');
});

test('operationalStatus: producing/idle se decide por ac_power (pac), no por pv_power (ppv)', () => {
  assert.equal(
    operationalStatus(freshRow({ pv_power: 5419.6, ac_power: 5193.79 }), NOW),
    'producing',
  );
  assert.equal(
    operationalStatus(freshRow({ pv_power: 5419.6, ac_power: 0 }), NOW),
    'idle',
  );
  assert.equal(
    operationalStatus(freshRow({ pv_power: 5419.6 }), NOW),
    'unknown',
  );
});

test('operationalStatus: incidencia confirmada prevalece sobre la producción', () => {
  assert.equal(
    operationalStatus(freshRow({ ac_power: 500 }, { warnCode: 5 }), NOW),
    'alarm',
  );
});

test('growattDeviceState prioriza alarm y clasifica online/offline/unknown', () => {
  assert.equal(growattDeviceState(freshRow({ ac_power: 500 }, { warnCode: 5 }), NOW), 'alarm');
  assert.equal(growattDeviceState(freshRow({ ac_power: 500 }), NOW), 'online');
  assert.equal(growattDeviceState({ raw_data: { lost: true } }, NOW), 'offline');
  assert.equal(growattDeviceState(freshRow({}, { lost: true }), NOW), 'unknown');
  assert.equal(growattDeviceState(null, NOW), 'unknown');
});

test('isSameCalendarDay compara el día local de la timezone', () => {
  assert.equal(
    isSameCalendarDay('2026-09-15T02:00:00Z', 'GMT-4', '2026-09-15T12:00:00Z'),
    true,
  );
  assert.equal(
    isSameCalendarDay('2026-09-15T02:00:00Z', 'GMT-4', '2026-09-16T12:00:00Z'),
    false,
  );
  assert.equal(isSameCalendarDay('no-date', 'GMT-4', '2026-09-15T12:00:00Z'), false);
});