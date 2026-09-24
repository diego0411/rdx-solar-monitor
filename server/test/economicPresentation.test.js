import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldShowExportValue } from '../../web/src/utils/economicPresentation.js';

test('muestra valor de exportación solo cuando corresponde', () => {
  assert.equal(shouldShowExportValue({ compensation_type: 'monetary', export_value: 0 }), true);
  assert.equal(shouldShowExportValue({ compensation_type: 'energy_credit', export_value: 15 }), true);
  assert.equal(shouldShowExportValue({ compensation_type: 'energy_credit', export_value: null }), false);
  assert.equal(shouldShowExportValue({ compensation_type: 'none', export_value: 0 }), false);
  assert.equal(shouldShowExportValue(null), false);
});
