import assert from 'node:assert/strict';
import test from 'node:test';

import { compensationValue, creditEstimatedValue, shouldShowExportValue } from '../../web/src/utils/economicPresentation.js';

test('muestra valor de exportación solo cuando corresponde', () => {
  assert.equal(shouldShowExportValue({ compensation_type: 'monetary', export_value: 0 }), true);
  assert.equal(shouldShowExportValue({ compensation_type: 'energy_credit', export_value: 15 }), true);
  assert.equal(shouldShowExportValue({ compensation_type: 'energy_credit', export_value: null }), false);
  assert.equal(shouldShowExportValue({ compensation_type: 'none', export_value: 0 }), false);
  assert.equal(shouldShowExportValue(null), false);
});

test('prefiere el alias export_compensation_value con fallback a export_value', () => {
  assert.equal(compensationValue({ export_compensation_value: 135, export_value: 135 }), 135);
  assert.equal(compensationValue({ export_value: 75 }), 75);
  assert.equal(compensationValue({ export_compensation_value: 0 }), 0);
  assert.equal(compensationValue(null), null);
  assert.equal(shouldShowExportValue({ compensation_type: 'energy_credit', export_compensation_value: 20 }), true);
  assert.equal(shouldShowExportValue({ compensation_type: 'energy_credit', export_compensation_value: null }), false);
});

test('creditEstimatedValue solo expone el alias de crédito', () => {
  assert.equal(creditEstimatedValue({ export_credit_estimated_value: 135 }), 135);
  assert.equal(creditEstimatedValue({ export_credit_estimated_value: null }), null);
  assert.equal(creditEstimatedValue(null), null);
});
