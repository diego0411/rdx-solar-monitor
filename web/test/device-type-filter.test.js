import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deviceInCategory,
  deviceTypeCategory,
  deviceTypeCategoryLabel,
  deviceTypeLabel,
  visibleDeviceTypeCategories,
} from '../src/utils/deviceDisplay.js';

const device = device_type => ({ device_type });

test('1. STRING_INVERTER se etiqueta como Inversor On-Grid', () => {
  assert.equal(deviceTypeCategory('STRING_INVERTER'), 'on_grid');
  assert.equal(deviceTypeLabel('STRING_INVERTER'), 'Inversor On-Grid');
});

test('2. INVERTER se etiqueta como Inversor On-Grid', () => {
  assert.equal(deviceTypeCategory('INVERTER'), 'on_grid');
  assert.equal(deviceTypeLabel('INVERTER'), 'Inversor On-Grid');
});

test('3. MIN se etiqueta como Inversor On-Grid', () => {
  assert.equal(deviceTypeCategory('MIN'), 'on_grid');
  assert.equal(deviceTypeLabel('MIN'), 'Inversor On-Grid');
});

test('4. min comparte categoria con MIN sin opcion duplicada', () => {
  assert.equal(deviceTypeCategory('min'), 'on_grid');
  assert.equal(deviceTypeLabel(' min '), 'Inversor On-Grid');
  assert.deepEqual(
    visibleDeviceTypeCategories([device('MIN'), device('min'), device('MIN')]),
    ['on_grid'],
  );
});

test('5. HYBRID_INVERTER se etiqueta como Inversor híbrido', () => {
  assert.equal(deviceTypeCategory('HYBRID_INVERTER'), 'hybrid');
  assert.equal(deviceTypeLabel('hybrid_inverter'), 'Inversor híbrido');
});

test('6. COLLECTOR se etiqueta como Comunicador', () => {
  assert.equal(deviceTypeCategory('COLLECTOR'), 'communicator');
  assert.equal(deviceTypeLabel('collector'), 'Comunicador');
});

test('7. tipo desconocido conserva opcion fallback visible y filtrable', () => {
  const category = deviceTypeCategory('SPH');
  assert.ok(category.startsWith('unknown:'));
  assert.equal(deviceTypeLabel('SPH'), 'SPH');
  assert.deepEqual(visibleDeviceTypeCategories([device('SPH')]), [category]);
  assert.equal(deviceInCategory(device('SPH'), category), true);
  assert.equal(deviceInCategory(device('MIN'), category), false);
});

test('8. SPH no se etiqueta artificialmente como híbrido', () => {
  assert.notEqual(deviceTypeCategory('SPH'), 'hybrid');
  assert.notEqual(deviceTypeCategory('sph'), 'hybrid');
  assert.notEqual(deviceTypeLabel('SPH'), 'Inversor híbrido');
});

test('9. On-Grid agrupa STRING_INVERTER + INVERTER + MIN/min y excluye el resto', () => {
  for (const type of ['STRING_INVERTER', 'INVERTER', 'MIN', 'min', ' min ']) {
    assert.equal(deviceInCategory(device(type), 'on_grid'), true);
  }
  for (const type of ['HYBRID_INVERTER', 'COLLECTOR', 'SPH', null, '']) {
    assert.equal(deviceInCategory(device(type), 'on_grid'), false);
  }
  assert.equal(deviceInCategory(device('MIN'), ''), true);
});

test('10. opciones: On-Grid, Híbrido y Comunicador sin duplicados legacy', () => {
  const categories = visibleDeviceTypeCategories([
    device('STRING_INVERTER'), device('INVERTER'), device('MIN'), device('min'),
    device('HYBRID_INVERTER'), device('COLLECTOR'),
  ]);
  assert.deepEqual(categories, ['on_grid', 'hybrid', 'communicator']);
  const labels = categories.map(deviceTypeCategoryLabel);
  assert.deepEqual(labels, ['Inversor On-Grid', 'Inversor híbrido', 'Comunicador']);
  assert.ok(!labels.includes('Inversor string'));
  assert.ok(!labels.includes('Inversor'));
});
