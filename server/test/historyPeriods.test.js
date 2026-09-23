import assert from 'node:assert/strict';
import test from 'node:test';

import { aggregateHistory, energyTimeType, hyxiHistoryStartTime, periodRange } from '../src/services/historyPeriods.js';

const localDate = row => row.date;
const energy = (date, generation, consumption = 1) => ({
  date,
  generation_kwh: generation,
  consumption_kwh: consumption,
  grid_import_kwh: 0,
  grid_export_kwh: null,
});

test('day, week, month and year generate the expected calendar ranges', () => {
  assert.deepEqual(periodRange('day', '2026-09-23'), { start: '2026-09-23', end: '2026-09-24', bucket: 'intraday' });
  assert.deepEqual(periodRange('week', '2026-09-23'), { start: '2026-09-21', end: '2026-09-28', bucket: 'day' });
  assert.deepEqual(periodRange('month', '2026-09-23'), { start: '2026-09-01', end: '2026-10-01', bucket: 'day' });
  assert.deepEqual(periodRange('year', '2026-09-23'), { start: '2026-01-01', end: '2027-01-01', bucket: 'month' });
});

test('HYXi month and year select existing timeType 2 and 3', () => {
  assert.equal(energyTimeType('day'), 1);
  assert.equal(energyTimeType('week'), 1);
  assert.equal(energyTimeType('month'), 2);
  assert.equal(energyTimeType('year'), 3);
  assert.equal(hyxiHistoryStartTime(2, '2026-09-23'), '2026-09');
  assert.equal(hyxiHistoryStartTime(3, '2026-09-23'), '2026');
});

test('week aggregation preserves zero and emits null buckets for missing days', () => {
  const result = aggregateHistory([
    energy('2026-09-21', 0, 0),
    energy('2026-09-23', 4),
  ], { period: 'week', selectedDate: '2026-09-23', kind: 'energy', localDate });
  assert.equal(result.buckets.length, 7);
  assert.equal(result.buckets[0].generation_kwh, 0);
  assert.equal(result.buckets[1].generation_kwh, null);
  assert.equal(result.buckets[1].coverage, 'none');
  assert.equal(result.buckets[2].generation_kwh, 4);
});

test('month aggregates intraday increments once and reports partial fields', () => {
  const result = aggregateHistory([
    energy('2026-09-02', 1),
    energy('2026-09-02', 2, null),
  ], { period: 'month', selectedDate: '2026-09-23', kind: 'energy', localDate });
  assert.equal(result.buckets.length, 30);
  assert.equal(result.buckets[1].generation_kwh, 3);
  assert.equal(result.buckets[1].consumption_kwh, 1);
  assert.equal(result.buckets[1].coverage, 'partial');
});

test('year returns twelve months without projecting absent history', () => {
  const result = aggregateHistory([
    energy('2026-09-01', 8),
    energy('2026-09-20', 2),
  ], { period: 'year', selectedDate: '2026-09-23', kind: 'energy', localDate });
  assert.equal(result.buckets.length, 12);
  assert.equal(result.buckets[0].generation_kwh, null);
  assert.equal(result.buckets[8].generation_kwh, 10);
  assert.equal(result.buckets[9].generation_kwh, null);
});

test('power aggregation averages samples instead of summing snapshots', () => {
  const result = aggregateHistory([
    { date: '2026-09-21', generation_power_w: 100, consumption_power_w: 20, grid_import_power_w: 0, grid_export_power_w: null },
    { date: '2026-09-21', generation_power_w: 300, consumption_power_w: 40, grid_import_power_w: 0, grid_export_power_w: null },
  ], { period: 'week', selectedDate: '2026-09-23', kind: 'power', localDate });
  assert.equal(result.buckets[0].generation_power_w, 200);
  assert.equal(result.buckets[0].grid_import_power_w, 0);
});
