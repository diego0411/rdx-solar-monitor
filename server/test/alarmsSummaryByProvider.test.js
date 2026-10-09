import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

// IMPORTANTE: sin imports estáticos de código bajo mock. Todo lo mockeado
// se importa dinámicamente DESPUÉS de registrar los mocks.
// Sin BD: el cliente Supabase está mockeado con un builder que registra
// filtros y devuelve conteos programados (head-only, sin filas).

const queries = [];
let countsByKey = {};
let failFrom = null;

function resetSupabaseFake() {
  queries.length = 0;
  countsByKey = {};
  failFrom = null;
}

function keyOf(filters) {
  return JSON.stringify(filters);
}

function chainable(table) {
  const state = { table, select: null, options: null, filters: [] };
  const chain = {
    select(columns, options) { state.select = columns; state.options = options ?? null; return chain; },
    eq(column, value) { state.filters.push(['eq', column, value]); return chain; },
    in(column, values) { state.filters.push(['in', column, values]); return chain; },
    gte(column, value) { state.filters.push(['gte', column, value]); return chain; },
    lte(column, value) { state.filters.push(['lte', column, value]); return chain; },
    then(resolve) {
      queries.push({ table: state.table, select: state.select, options: state.options, filters: state.filters.map(entry => [...entry]) });
      if (failFrom === table) {
        resolve({ count: null, error: new Error('supabase caído') });
      } else {
        resolve({ count: countsByKey[keyOf(state.filters)] ?? 0, error: null });
      }
    },
  };
  return chain;
}

mock.module('../src/config/supabase.js', {
  namedExports: {
    supabase: { from: table => chainable(table) },
  },
});

const { getAlarmsSummary } = await import('../src/repositories/alarms.repository.js');

function programActiveCounts({ hyxi, growatt, scope }) {
  const inScope = scope === null ? [] : [['in', 'plant_id', scope]];
  countsByKey[keyOf([['eq', 'status', 'active'], ...inScope])] = hyxi + growatt;
  countsByKey[keyOf([['eq', 'status', 'active'], ['eq', 'provider', 'hyxi'], ...inScope])] = hyxi;
  countsByKey[keyOf([['eq', 'status', 'active'], ['eq', 'provider', 'growatt'], ...inScope])] = growatt;
}

test('desglose cuenta solo activas por fabricante con el mismo alcance', async () => {
  resetSupabaseFake();
  programActiveCounts({ hyxi: 2, growatt: 1, scope: ['p1'] });
  const summary = await getAlarmsSummary({ plantIds: new Set(['p1']), resolvedSince: '2026-10-01T00:00:00.000Z' });
  assert.deepEqual(summary.by_provider, { hyxi: 2, growatt: 1 });
  assert.equal(summary.active, 3);
});

test('conteos son head-only sin filas y con status active + scope', async () => {
  resetSupabaseFake();
  programActiveCounts({ hyxi: 0, growatt: 0, scope: null });
  await getAlarmsSummary({ plantIds: null, resolvedSince: '2026-10-01T00:00:00.000Z' });
  const byProvider = queries.filter(call =>
    call.filters.some(([kind, column, value]) => kind === 'eq' && column === 'provider'),
  );
  assert.equal(byProvider.length, 2);
  for (const call of byProvider) {
    assert.equal(call.select, 'id');
    assert.deepEqual(call.options, { count: 'exact', head: true });
    assert.ok(call.filters.some(([kind, column, value]) => kind === 'eq' && column === 'status' && value === 'active'),
      'by_provider debe filtrar status=active (resueltas excluidas)');
  }
  assert.ok(!queries.some(call => 'range' in call), 'sin lectura de filas');
});

test('campos globales intactos y alcance vacío devuelve ceros sin consultas', async () => {
  resetSupabaseFake();
  countsByKey[keyOf([['eq', 'status', 'active']])] = 5;
  countsByKey[keyOf([['eq', 'status', 'active'], ['eq', 'severity', 'critical']])] = 1;
  countsByKey[keyOf([['eq', 'status', 'active'], ['eq', 'severity', 'warning']])] = 2;
  const summary = await getAlarmsSummary({ plantIds: null, resolvedSince: '2026-10-01T00:00:00.000Z' });
  assert.equal(summary.active, 5);
  assert.equal(summary.critical, 1);
  assert.equal(summary.warning, 2);
  assert.deepEqual(summary.by_provider, { hyxi: 0, growatt: 0 });

  resetSupabaseFake();
  const empty = await getAlarmsSummary({ plantIds: new Set(), resolvedSince: '2026-10-01T00:00:00.000Z' });
  assert.deepEqual(empty, { active: 0, critical: 0, warning: 0, resolved_7d: 0, by_provider: { hyxi: 0, growatt: 0 } });
  assert.equal(queries.length, 0);
});

test('error de Supabase propaga el mensaje original', async () => {
  resetSupabaseFake();
  failFrom = 'alarms';
  await assert.rejects(getAlarmsSummary({ plantIds: null, resolvedSince: null }), /No se pudo consultar el resumen de alarmas/);
});
