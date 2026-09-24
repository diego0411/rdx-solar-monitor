import assert from 'node:assert/strict';
import test from 'node:test';
import { theoreticalPanelCapacityKwp } from '../../web/src/utils/installationDetails.js';

test('calcula potencia teórica sin reemplazar la capacidad de planta', () => {
  assert.equal(theoreticalPanelCapacityKwp(10, 550), 5.5);
  assert.equal(theoreticalPanelCapacityKwp(0, 550), null);
  assert.equal(theoreticalPanelCapacityKwp(10, null), null);
});
