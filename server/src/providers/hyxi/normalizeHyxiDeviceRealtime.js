const realtimeStates = new Map([[1, 'online'], [2, 'offline'], [3, 'alarm'], [10, 'inactive']]);
// HYXi: ppv, acP, pvNp y phNLoadp en W; voltajes en V y corrientes en A.
// f: Hz; tinv: °C; acE y totalE: kWh; batSoc: porcentaje numérico.
// gridP conserva exactamente el valor HYXi, sin conversión de unidad.
// ph1Loadp/ph2Loadp/ph3Loadp (W): load_power = suma de las fases
// presentes; null si ninguna fase existe o es válida.
const realtimeFields = {
  ppv: 'pv_power', acP: 'ac_power', gridP: 'grid_power', batSoc: 'battery_soc',
  pv1v: 'pv1_voltage', pv1i: 'pv1_current', pv1p: 'pv1_power',
  pv2v: 'pv2_voltage', pv2i: 'pv2_current', pv2p: 'pv2_power',
  f: 'frequency', tinv: 'inverter_temperature', vbus: 'bus_voltage',
  acE: 'today_energy', totalE: 'total_energy',
};
const loadPhaseKeys = ['ph1Loadp', 'ph2Loadp', 'ph3Loadp'];

function numeric(value) {
  if (!['string', 'number'].includes(typeof value) || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeHyxiDeviceRealtime(data, deviceId) {
  if (!Array.isArray(data) || data.some(item => !item || typeof item.dataKey !== 'string')) {
    throw new Error('Invalid HYXi realtime data');
  }
  const values = Object.fromEntries(data.map(({ dataKey, dataValue }) => [dataKey, dataValue]));
  const seconds = numeric(values.collectTime);
  const date = seconds === null ? null : new Date(seconds * 1000);
  const loadPhases = loadPhaseKeys
    .map(key => numeric(values[key]))
    .filter(value => value != null);
  return {
    device_id: deviceId,
    provider: 'hyxi',
    collected_at: date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
    device_status: realtimeStates.get(numeric(values.deviceState)) ?? 'unknown',
    ...Object.fromEntries(Object.entries(realtimeFields).map(([key, column]) => [column, numeric(values[key])])),
    load_power: loadPhases.length
      ? loadPhases.reduce((total, value) => total + value, 0)
      : null,
    battery_power: numeric(values.pbat) ?? numeric(values.batP),
    raw_data: data,
  };
}
