import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGrowattPlantDetails } from '../src/providers/growatt/normalizeGrowattPlant.js';

const detailsRaw = {
  plant_id: '10791770', timezone: 'GMT+4', plant_type: 0, address1: 'Av. Quinto Anillo',
  city: 'Santa Cruz de la Sierra', country: 'Bolivia', create_date: '2026-03-20',
};

test('plant_details mapea timezone, address1 y plant_type 0 a residential', () => {
  const detail = normalizeGrowattPlantDetails(detailsRaw);
  assert.equal(detail.timezone, 'GMT+4');
  assert.equal(detail.address, 'Av. Quinto Anillo');
  assert.equal(detail.plant_type, 'residential');
});

test('plant_type numérico comercial/ground_mounted se mapea', () => {
  assert.equal(normalizeGrowattPlantDetails({ plant_type: 1 }).plant_type, 'commercial');
  assert.equal(normalizeGrowattPlantDetails({ plant_type: 2 }).plant_type, 'ground_mounted');
  assert.equal(normalizeGrowattPlantDetails({ plant_type: '2' }).plant_type, 'ground_mounted');
});

test('valores inválidos se filtran a null, sin fabricar', () => {
  const detail = normalizeGrowattPlantDetails({
    timezone: null, address1: '  ', plant_type: 99,
    city: 'null', country: '', create_date: undefined,
  });
  assert.equal(detail.timezone, null);
  assert.equal(detail.address, null);
  assert.equal(detail.plant_type, null);
  assert.equal(detail.metadata?.city, null);
  assert.equal(detail.metadata?.country, null);
  assert.equal(detail.metadata?.create_date, null);
});

test('address1 se recorta y conserva el resto de metadata', () => {
  const detail = normalizeGrowattPlantDetails({
    ...detailsRaw, address1: '  7R6M+7JM, Av. Quinto Anillo  ', plant_type: '0',
  });
  assert.equal(detail.address, '7R6M+7JM, Av. Quinto Anillo');
  assert.equal(detail.plant_type, 'residential');
  assert.equal(detail.metadata?.city, 'Santa Cruz de la Sierra');
  assert.equal(detail.metadata?.country, 'Bolivia');
  assert.equal(detail.metadata?.create_date, '2026-03-20');
});