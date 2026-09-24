import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canManageEconomicTariffs,
  validateEnergyTariff,
} from '../src/controllers/plantEconomics.controller.js';
import { plantInScope } from '../src/middleware/authorization.middleware.js';

test('administradores pueden escribir y usuarios de monitoreo solo leer', () => {
  assert.equal(canManageEconomicTariffs('rdx_admin'), true);
  assert.equal(canManageEconomicTariffs('client_admin'), true);
  assert.equal(canManageEconomicTariffs('client_user'), false);
});

test('alcance de planta se conserva para lectura y escritura', () => {
  assert.equal(plantInScope({ plantIds: null }, 'plant-a'), true);
  assert.equal(plantInScope({ plantIds: new Set(['plant-a']) }, 'plant-a'), true);
  assert.equal(plantInScope({ plantIds: new Set(['plant-a']) }, 'plant-b'), false);
});

test('valida BOB, fechas y tarifa monetaria', () => {
  assert.deepEqual(validateEnergyTariff({
    effective_from: '2026-09-01',
    effective_to: null,
    purchase_energy_rate: 0.8,
    export_energy_rate: 0.5,
    currency: 'bob',
    export_compensation_type: 'monetary',
    distributor: 'CRE R.L.',
    tariff_category: 'Configurable',
  }), {
    effective_from: '2026-09-01',
    effective_to: null,
    purchase_energy_rate: 0.8,
    export_energy_rate: 0.5,
    currency: 'BOB',
    export_compensation_type: 'monetary',
    distributor: 'CRE R.L.',
    tariff_category: 'Configurable',
  });
  assert.equal(validateEnergyTariff({
    effective_from: '2026-09-01', purchase_energy_rate: 0.8,
    currency: 'BOB', export_compensation_type: 'monetary',
  }), null);
});
