import assert from 'node:assert/strict';
import test from 'node:test';

import { intradayEnergyBucket } from '../src/controllers/energyHistory.controller.js';
import { projectEnergySeriesRow } from '../src/repositories/energyIntervals.repository.js';
import { preserveEnergyProvenance } from '../src/services/growattEnergyHistory.service.js';

const values = {
  interval_start: '2026-09-28T09:53:23.000Z',
  timezone: 'GMT-4',
  generation_kwh: 0,
  consumption_kwh: 5.899993896484375,
  grid_import_kwh: 5.899993896484375,
  grid_export_kwh: 0,
};

test('endpoint intradía expone solo provenance mínima y conserva los kWh', () => {
  const stored = {
    ...values,
    raw_data: {
      secret_provider_payload: { must_not_leak: true },
      energy_provenance: {
        grid_import_kwh: { source: 'growatt_meter', first_daily_counter: true },
        grid_export_kwh: { source: 'growatt_meter', first_daily_counter: true },
        consumption_kwh: { source: 'derived', depends_on_first_daily_counter: true },
      },
    },
  };

  const bucket = intradayEnergyBucket(projectEnergySeriesRow(stored));
  assert.deepEqual(bucket, {
    ...values,
    energy_provenance: stored.raw_data.energy_provenance,
  });
  assert.equal(Object.hasOwn(bucket, 'raw_data'), false);
  assert.equal(JSON.stringify(bucket).includes('secret_provider_payload'), false);
});

test('endpoint intradía mantiene registros legacy sin provenance', () => {
  const bucket = intradayEnergyBucket(projectEnergySeriesRow({
    ...values,
    raw_data: { devices: [{ data: { positiveActiveTodayEnergy: 5.9 } }] },
  }));

  assert.deepEqual(bucket, { ...values, energy_provenance: null });
});

const oldProvenance = {
  grid_import_kwh: { source: 'growatt_meter', first_daily_counter: true },
};
const newProvenance = {
  grid_import_kwh: { source: 'growatt_meter', first_daily_counter: false },
};

function storedRow(energyProvenance) {
  return {
    ...values,
    raw_data: {
      devices: [{ serial_number: 'MIN-1' }],
      ...(energyProvenance == null ? {} : { energy_provenance: energyProvenance }),
    },
  };
}

test('Growatt conserva provenance existente si la derivación nueva no trae provenance', () => {
  const incoming = storedRow(null);
  const existing = storedRow(oldProvenance);
  existing.interval_start = '2026-09-28T09:53:23+00:00';
  const [result] = preserveEnergyProvenance([incoming], [existing]);

  assert.deepEqual(result.raw_data.energy_provenance, oldProvenance);
  assert.deepEqual(Object.fromEntries(Object.keys(values).map(key => [key, result[key]])), values);
  assert.deepEqual(result.raw_data.devices, incoming.raw_data.devices);
});

test('Growatt usa provenance nueva explícita sobre la existente', () => {
  const incoming = storedRow(newProvenance);
  const [result] = preserveEnergyProvenance([incoming], [storedRow(oldProvenance)]);

  assert.strictEqual(result, incoming);
  assert.deepEqual(result.raw_data.energy_provenance, newProvenance);
  assert.deepEqual(Object.fromEntries(Object.keys(values).map(key => [key, result[key]])), values);
});

test('Growatt mantiene ausencia de provenance si no existe ni llega una nueva', () => {
  const incoming = storedRow(null);
  const [result] = preserveEnergyProvenance([incoming], [storedRow(null)]);

  assert.strictEqual(result, incoming);
  assert.equal(result.raw_data.energy_provenance, undefined);
  assert.deepEqual(Object.fromEntries(Object.keys(values).map(key => [key, result[key]])), values);
});
