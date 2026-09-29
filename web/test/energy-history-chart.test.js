import assert from 'node:assert/strict';
import test from 'node:test';

import { toVisualEnergyPoint } from '../src/utils/energyHistoryChart.js';

const point = {
  interval_start: '2026-09-28T09:53:23.000Z',
  generation_kwh: 0,
  consumption_kwh: 5.9,
  grid_import_kwh: 5.9,
  grid_export_kwh: 0,
};

test('first import y consumption dependiente se ocultan sin alterar generation', () => {
  const visual = toVisualEnergyPoint({
    ...point,
    energy_provenance: {
      grid_import_kwh: { source: 'growatt_meter', first_daily_counter: true },
      grid_export_kwh: { source: 'growatt_meter', first_daily_counter: false },
      consumption_kwh: { source: 'derived', depends_on_first_daily_counter: true },
    },
  });

  assert.equal(visual.generation_kwh, 0);
  assert.equal(visual.consumption_kwh, null);
  assert.equal(visual.grid_import_kwh, null);
  assert.equal(visual.grid_export_kwh, 0);
});

test('export solo se oculta con provenance explícita first=true', () => {
  const visual = toVisualEnergyPoint({
    ...point,
    grid_export_kwh: 12,
    energy_provenance: {
      grid_export_kwh: { source: 'growatt_meter', first_daily_counter: true },
    },
  });

  assert.equal(visual.grid_export_kwh, null);
  assert.equal(visual.grid_import_kwh, 5.9);
  assert.equal(visual.consumption_kwh, 5.9);
});

test('first=false y legacy sin provenance conservan todos los valores', () => {
  const normal = {
    ...point,
    energy_provenance: {
      grid_import_kwh: { source: 'growatt_meter', first_daily_counter: false },
      grid_export_kwh: { source: 'growatt_meter', first_daily_counter: false },
      consumption_kwh: { source: 'derived', depends_on_first_daily_counter: false },
    },
  };
  assert.deepEqual(toVisualEnergyPoint(normal), normal);
  assert.deepEqual(toVisualEnergyPoint(point), point);
  assert.equal(toVisualEnergyPoint({ ...point, grid_import_kwh: 999 }).grid_import_kwh, 999);
});

test('transformación crea una copia y no muta la respuesta original', () => {
  const original = {
    ...point,
    energy_provenance: {
      grid_import_kwh: { source: 'growatt_meter', first_daily_counter: true },
    },
  };
  const snapshot = structuredClone(original);
  const visual = toVisualEnergyPoint(original);

  assert.notEqual(visual, original);
  assert.deepEqual(original, snapshot);
  assert.equal(original.grid_import_kwh, 5.9);
  assert.equal(visual.grid_import_kwh, null);
  assert.equal(visual.generation_kwh, original.generation_kwh);
});
