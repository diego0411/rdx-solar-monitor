import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

mock.module('../src/config/supabase.js', { exports: { supabase: {} } });
const { mergeHyxiMetadata } = await import('../src/repositories/devices.repository.js');

test('devicePage preserva metadata.detail obtenida de queryDeviceInfo', () => {
  const detail = { model: 'HYX-H6K-HT', pvNum: 2, batCap: 10 };
  const merged = mergeHyxiMetadata(
    { deviceSn: 'old', detail },
    { deviceSn: 'new', deviceState: 1 },
  );
  assert.equal(merged.deviceSn, 'new');
  assert.equal(merged.deviceState, 1);
  assert.deepEqual(merged.detail, detail);
});
