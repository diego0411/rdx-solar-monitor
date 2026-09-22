import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGrowattTlxDataInfo } from '../src/providers/growatt/normalizeGrowattTlxDataInfo.js';

test('mapea firmware y versiones desde tlx_data_info', () => {
  const info = normalizeGrowattTlxDataInfo({
    error_code: 0,
    data: {
      fwVersion: 'AK1.0', innerVersion: 'AKAA2350',
      communicationVersion: 'ZAAA-0026', hwVersion: 'HW3', modelText: 'S19B09D00T00P0FU01M003C',
    },
  });
  assert.equal(info.valid, true);
  assert.equal(info.software_version, 'AK1.0');
  assert.equal(info.hwVersion, 'HW3');
  assert.equal(info.modelText, 'S19B09D00T00P0FU01M003C');
  assert.deepEqual(info.metadata, {
    innerVersion: 'AKAA2350', communicationVersion: 'ZAAA-0026',
  });
});

test('respuesta con error o sin data se descarta', () => {
  assert.equal(normalizeGrowattTlxDataInfo(null).valid, false);
  assert.equal(normalizeGrowattTlxDataInfo({ error_code: 10001 }).valid, false);
  assert.equal(normalizeGrowattTlxDataInfo({ error_code: 0 }).valid, false);
});

test('solo valores válidos se conservan', () => {
  const info = normalizeGrowattTlxDataInfo({
    error_code: 0,
    data: {
      fwVersion: '', innerVersion: 'null', communicationVersion: null,
      hwVersion: '  ', modelText: '',
    },
  });
  assert.equal(info.valid, true);
  assert.equal(info.software_version, null);
  assert.equal(info.hwVersion, null);
  assert.equal(info.modelText, null);
  assert.deepEqual(info.metadata, {});
});