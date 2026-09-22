import test from 'node:test';
import assert from 'node:assert/strict';
import { createGrowattCurrentAlarmsService } from '../src/services/growattCurrentAlarms.service.js';

function row(raw_data, device = {}) {
  return {
    device: {
      id: 'd1', name: 'Inversor', serial_number: 'MIN123', device_type: 'MIN',
      provider: 'growatt', active: true,
      plant: { id: 'p1', name: 'Planta', external_plant_id: 'e1' }, ...device,
    },
    collected_at: '2026-09-16T12:00:00Z', raw_data,
  };
}

test('detecta cada condición de incidencia y conserva los valores originales', async () => {
  const inputs = [
    { status: 3 }, { status: '3' }, { status: ' Fault ' },
    { status: 1, faultType: 12 }, { status: '1', faultType: '12' },
    { status: 0, warnCode: 8 }, { status: 1, warnCode: '8' },
  ].map(raw => row({ errorText: 'Error original', warnText: 'Aviso original', ...raw }));
  const getCurrent = createGrowattCurrentAlarmsService({ listLatest: async () => inputs });
  const { alarms } = await getCurrent();
  assert.deepEqual(alarms, inputs.map(({ device, collected_at, raw_data }) => ({
    plant: device.plant,
    device: { id: device.id, name: device.name, serial_number: device.serial_number, device_type: 'MIN' },
    collected_at, status: raw_data.status,
    faultType: raw_data.faultType ?? null, warnCode: raw_data.warnCode ?? null,
    errorText: raw_data.errorText, warnText: raw_data.warnText,
  })));
});

test('omite datos ausentes, códigos cero o inválidos y textos sin incidencia', async () => {
  const inputs = [null, undefined, [], {},
    { status: 1, faultType: 0, warnCode: 0 },
    { status: '0', faultType: '0', warnCode: '00' },
    { status: 2, faultType: null, warnCode: '' },
    { faultType: 'invalid', warnCode: false },
    { errorText: 'Texto sin código', warnText: 'Texto sin código' },
  ].map(raw => row(raw));
  const getCurrent = createGrowattCurrentAlarmsService({ listLatest: async () => inputs });
  assert.deepEqual(await getCurrent(), { alarms: [] });
});

test('incluye solo Growatt MIN activos y permite planta o fecha ausentes', async () => {
  const inputs = [
    row({ status: 3 }, { active: false }),
    row({ status: 3 }, { provider: 'hyxi' }),
    row({ status: 3 }, { device_type: 'SPH' }),
    { ...row({ warnCode: 1 }, { device_type: 'min', plant: null }), collected_at: null },
  ];
  const getCurrent = createGrowattCurrentAlarmsService({ listLatest: async () => inputs });
  const { alarms } = await getCurrent();
  assert.equal(alarms.length, 1);
  assert.equal(alarms[0].plant, null);
  assert.equal(alarms[0].collected_at, null);
  assert.equal(alarms[0].errorText, null);
});

test('consulta datos actuales en cada petición y propaga errores de lectura', async () => {
  let calls = 0;
  const getCurrent = createGrowattCurrentAlarmsService({ listLatest: async () => {
    calls += 1;
    if (calls === 3) throw new Error('Lectura fallida');
    return calls === 1 ? [row({ faultType: 1 })] : [];
  } });
  assert.equal((await getCurrent()).alarms.length, 1);
  assert.deepEqual(await getCurrent(), { alarms: [] });
  await assert.rejects(getCurrent, /Lectura fallida/);
});
