import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

// IMPORTANTE: solo se mockea la config de Supabase con un doble que
// captura la proyección y sirve páginas. Repositorio y servicio son los
// REALES: la equivalencia se comprueba de extremo a extremo.
// Sin BD ni red: todo el I/O está mockeado.

const TZ = 'America/La_Paz';
const PLANT_ID = '33333333-3333-3333-3333-333333333333';

let energyPages = [];
let tariffRows = [];
let capturedSelect = null;
let rangeCalls = 0;

function chain(table) {
  const payload = () => ({
    data: table === 'energy_intervals' ? (energyPages[0] ?? []) : tariffRows, error: null,
  });
  const self = {
    select(cols) {
      if (table === 'energy_intervals') capturedSelect = cols;
      return self;
    },
    eq: () => self,
    lt: () => self,
    gte: () => self,
    or: () => self,
    order: () => self,
    // Las lecturas de una sola página (tarifas) esperan la cadena sin
    // .range(): los builders reales son thenables; el doble también.
    then(resolve) {
      resolve(payload());
    },
    range(offset) {
      rangeCalls += 1;
      const page = energyPages[Math.floor(offset / 1000)] ?? [];
      return Promise.resolve({ data: table === 'energy_intervals' ? page : tariffRows, error: null });
    },
  };
  return self;
}

mock.module('../src/config/supabase.js', {
  namedExports: { supabase: { from: table => chain(table) } },
});

const {
  listEnergyIntervalsRange,
  listEnergyIntervalsEconomicsRange,
} = await import('../src/repositories/energyIntervals.repository.js');
const { calculatePlantEconomics, getPlantEconomicSummary } = await import(
  '../src/services/plantEconomics.service.js'
);
const { periodRange } = await import('../src/services/historyPeriods.js');
const { localDateKey } = await import('../src/utils/timezone.js');

function reset() {
  energyPages = [];
  tariffRows = [];
  capturedSelect = null;
  rangeCalls = 0;
}

// Fila DB completa tal como la devuelve la proyección compartida.
const fullRow = (time, values, raw) => ({
  interval_start: `${time}.000Z`,
  timezone: TZ,
  generation_kwh: values[0],
  consumption_kwh: values[1],
  grid_import_kwh: values[2],
  grid_export_kwh: values[3],
  provider: 'hyxi',
  updated_at: '2026-09-02T20:00:00.000Z',
  raw_data: raw,
});

// Derivación tal como la entregaría PostgREST con raw_data->>coverage.

const tariffMonetary = {
  id: 't1', plant_id: PLANT_ID, effective_from: '2026-09-01', effective_to: '2026-09-01',
  purchase_energy_rate: 1, export_energy_rate: 0.5, currency: 'BOB',
  export_compensation_type: 'monetary', distributor: null, tariff_category: null,
  created_at: null, updated_at: null,
};
const tariffNone = {
  ...tariffMonetary, id: 't2', effective_from: '2026-09-02', effective_to: '2026-09-02',
  export_compensation_type: 'none',
};

test('la proyección Economics usa columnas tradicionales con raw_data completo', async () => {
  reset();
  const row = fullRow('2026-09-01T12:00:00', [1, 2, 3, 4], { coverage: 'partial', extra: [1] });
  energyPages = [[row]];
  const rows = await listEnergyIntervalsEconomicsRange(PLANT_ID, '2026-09-01', '2026-09-02');
  assert.equal(rows.length, 1);
  assert.ok(!capturedSelect.includes('->>'));
  assert.ok(capturedSelect.split(',').some(column => column.trim() === 'raw_data'));
  for (const column of ['generation_kwh', 'consumption_kwh', 'grid_import_kwh', 'grid_export_kwh',
    'interval_start', 'timezone', 'provider', 'updated_at']) {
    assert.ok(capturedSelect.includes(column), `falta columna: ${column}`);
  }
  assert.deepEqual(rows, [{ ...row, local_date: '2026-09-01' }]);
});

test('la función compartida original conserva raw_data completo', async () => {
  reset();
  const row = fullRow('2026-09-01T12:00:00', [1, 2, 3, 4], { coverage: 'partial', extra: [1] });
  energyPages = [[row]];
  const rows = await listEnergyIntervalsRange(PLANT_ID, 1, '2026-09-01', '2026-09-02');
  assert.ok(capturedSelect.split(',').some(column => column.trim() === 'raw_data'));
  assert.deepEqual(rows, [row]);
});

test('equivalencia: partial, nulos, raw ausente y none/monetary', async () => {
  reset();
  tariffRows = [tariffMonetary, tariffNone];
  const full = [
    fullRow('2026-09-01T12:00:00', [10, 12, 3, 2], { coverage: 'partial' }),
    fullRow('2026-09-01T12:15:00', [11, null, 4, 1], null),
    fullRow('2026-09-02T12:00:00', [5, 0, 0, 0], {}),
    fullRow('2026-09-02T12:15:00', [6, 0, 0, 0], { coverage: 'available' }),
  ];
  energyPages = [full];
  const selectedDate = '2026-09-01';
  const actual = await getPlantEconomicSummary(PLANT_ID, 'week', selectedDate);
  const range = periodRange('week', selectedDate);
  const expected = calculatePlantEconomics(full, tariffRows, {
    period: 'week', start: range.start, end: range.end,
  });
  assert.deepEqual(actual, expected);
  // El caso ejercita: source_partial, null honesto, día sospechoso (02/09),
  // frontera de tarifa y compensación none.
  assert.ok(actual.coverage.suspect_days.includes('2026-09-02'));
});

test('equivalencia: energy_credit con moneda mixta', async () => {  reset();
  tariffRows = [
    tariffMonetary,
    { ...tariffNone, id: 't3', effective_from: '2026-09-02', effective_to: null, currency: 'USD', export_compensation_type: 'energy_credit', purchase_energy_rate: 2 },
  ];
  const full = [
    fullRow('2026-09-01T12:00:00', [10, 4, 1, 6], { coverage: 'partial' }),
    fullRow('2026-09-02T12:00:00', [8, 3, 0, 5], null),
  ];
  energyPages = [full];
  const selectedDate = '2026-09-01';
  const actual = await getPlantEconomicSummary(PLANT_ID, 'week', selectedDate);
  const range = periodRange('week', selectedDate);
  const expected = calculatePlantEconomics(full, tariffRows, {
    period: 'week', start: range.start, end: range.end,
  });
  assert.deepEqual(actual, expected);
  assert.equal(actual.coverage.mixed_currency, true);
  assert.equal(actual.production_value, null);
  assert.equal(actual.metrics.self_consumption_savings.quality, 'UNAVAILABLE');
});

test('repositorio adjunta local_date calculado en el filtrado', async () => {
  reset();
  const instants = [
    ['2026-09-01T03:59:59', TZ, '2026-08-31'],
    ['2026-09-01T04:00:00', TZ, '2026-09-01'],
    ['2026-07-01T03:59:59', 'America/Santiago', '2026-06-30'],
    ['2026-01-01T02:59:59', 'America/Santiago', '2025-12-31'],
  ];
  energyPages = [instants.map(([time, zone]) => ({
    interval_start: `${time}.000Z`,
    timezone: zone,
    generation_kwh: 1, consumption_kwh: 1, grid_import_kwh: 0, grid_export_kwh: 0,
    provider: 'hyxi', updated_at: '2026-09-02T20:00:00.000Z', coverage: null,
  }))];
  const rows = await listEnergyIntervalsEconomicsRange(PLANT_ID, '2025-12-31', '2026-09-02');
  assert.equal(rows.length, 4);
  for (const [index, [time, zone, expected]] of instants.entries()) {
    assert.equal(rows[index].local_date, expected);
    assert.equal(rows[index].local_date, localDateKey(`${time}.000Z`, zone));
  }
});

test('equivalencia con y sin local_date precalculada en fronteras', () => {
  const tariffs = [tariffMonetary];
  const rows = [
    { interval_start: '2026-09-01T03:59:59.000Z', timezone: TZ, generation_kwh: 2, consumption_kwh: 1, grid_import_kwh: 0, grid_export_kwh: 1, provider: 'hyxi', updated_at: '2026-09-02T20:00:00.000Z', raw_data: null },
    { interval_start: '2026-09-01T04:00:00.000Z', timezone: TZ, generation_kwh: 2, consumption_kwh: 1, grid_import_kwh: 0, grid_export_kwh: 1, provider: 'hyxi', updated_at: '2026-09-02T20:00:00.000Z', raw_data: null },
    { interval_start: '2026-07-01T03:59:59.000Z', timezone: 'America/Santiago', generation_kwh: 3, consumption_kwh: 1, grid_import_kwh: 0, grid_export_kwh: 2, provider: 'hyxi', updated_at: '2026-09-02T20:00:00.000Z', raw_data: null },
    { interval_start: '2026-01-01T02:59:59.000Z', timezone: 'America/Santiago', generation_kwh: 3, consumption_kwh: 1, grid_import_kwh: 0, grid_export_kwh: 2, provider: 'hyxi', updated_at: '2026-09-02T20:00:00.000Z', raw_data: null },
  ];
  const withPrecomputed = rows.map(row => ({
    ...row, local_date: localDateKey(row.interval_start, row.timezone),
  }));
  const options = { period: 'week', start: '2025-12-31', end: '2026-09-07' };
  assert.deepEqual(
    calculatePlantEconomics(withPrecomputed, tariffs, options),
    calculatePlantEconomics(rows, tariffs, options),
  );
});

test('la fecha local decide la tarifa aplicable en el borde de medianoche', () => {
  const august = { ...tariffMonetary, id: 'aug', effective_from: '2026-08-01', effective_to: '2026-08-31' };
  const september = { ...tariffMonetary, id: 'sep', effective_from: '2026-09-01', effective_to: null, purchase_energy_rate: 9 };
  // 03:30 UTC = 23:30 del 31/08 en La Paz: aplica la tarifa de agosto.
  const rows = [{
    interval_start: '2026-09-01T03:30:00.000Z', timezone: TZ,
    generation_kwh: 2, consumption_kwh: 1, grid_import_kwh: 0, grid_export_kwh: 0,
    provider: 'hyxi', updated_at: '2026-09-02T20:00:00.000Z', raw_data: null,
    local_date: '2026-08-31',
  }];
  const summary = calculatePlantEconomics(rows, [august, september], {
    period: 'day', start: '2026-08-31', end: '2026-09-01',
  });
  assert.equal(summary.production_value, 2);
  assert.equal(summary.purchase_energy_rate, 1);
  assert.equal(summary.compensation_type, 'monetary');
});
