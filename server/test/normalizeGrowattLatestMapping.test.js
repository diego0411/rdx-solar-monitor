import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeGrowattLatestData } from '../src/providers/growatt/normalizeGrowattLatestData.js';

test('normalización realtime: ppv→pv_power (DC) y pac→ac_power (AC)', () => {
  const normalized = normalizeGrowattLatestData(
    {
      time: '2026-09-15 10:00:00',
      status: 1,
      statusText: 'Normal',
      lost: false,
      ppv: 5419.6,
      pac: 5193.79,
      pacToLocalLoad: 1373.3,
      pacToUserTotal: 0,
      pacToGridTotal: 3820.5,
      eacToday: 12.5,
      eacTotal: 900.25,
    },
    'd1',
    'GMT-4',
    Date.parse('2026-09-15T14:01:00.000Z'),
  );

  assert.equal(normalized.pv_power, 5419.6);
  assert.equal(normalized.ac_power, 5193.79);
  assert.equal(normalized.load_power, 1373.3);
  assert.equal(normalized.grid_import_power, 0);
  assert.equal(normalized.grid_export_power, 3820.5);
  assert.equal(normalized.today_energy, 12.5);
  assert.equal(normalized.total_energy, 900.25);
  assert.equal(normalized.device_status, 'online');
});
