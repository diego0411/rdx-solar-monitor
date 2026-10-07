import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { ref, computed } from 'vue';

const viewSource = readFileSync(new URL('../src/views/DashboardView.vue', import.meta.url), 'utf8');
const { descriptor } = parse(viewSource);
const code = compileScript(descriptor, { id: 'dashboard-test' }).content
  .replace(/^import .*;$/gm, '').replace('export default', 'return');

const flush = () => new Promise(resolve => setImmediate(resolve));

function setup({ totals = { hyxi: 0, growatt: 0 }, fail = null } = {}) {
  const sent = [];
  const deps = {
    ref, computed, onMounted() {}, onUnmounted() {},
    apiFetch: async () => ({ providers: [], top_plants: [] }),
    listAlarms: async params => {
      sent.push(params);
      if (fail === params.provider) throw new Error('down');
      return {
        alarms: [],
        pagination: { page: 1, page_size: 1, total: totals[params.provider] ?? 0, total_pages: 1 },
      };
    },
  };
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps));
  return { view: component.setup({}, { expose() {} }), sent };
}

async function loaded(options) {
  const { view, sent } = setup(options);
  view.fetchDashboard();
  await flush(); await flush(); await flush();
  return { view, sent };
}

// 1. contrato: solo API normalizada, sin legacy
test('1: dashboard usa /api/alarms activas; sin endpoints legacy', async () => {
  assert.equal(viewSource.includes('alarms/recent'), false);
  assert.equal(viewSource.includes('alarms/current'), false);
  assert.equal(viewSource.includes('integrations/'), false);
  const { sent } = await loaded();
  assert.deepEqual(sent, [
    { provider: 'growatt', status: 'active', pageSize: 1 },
    { provider: 'hyxi', status: 'active', pageSize: 1 },
  ]);
});

// 2. caso producción: 20 eventos legacy resueltos equivalen a 0 activas
test('2: HYXi active=0 muestra 0 sin warning aunque exista historial resuelto', async () => {
  const { view } = await loaded({ totals: { hyxi: 0, growatt: 0 } });
  assert.equal(view.hyxiAlarmCount.value, 0);
  assert.equal(view.growattAlarmCount.value, 0);
  assert.equal(view.currentIncidents.value, 0);
});

// 3. HYXi con 2 activas
test('3: HYXi active=2 muestra 2', async () => {
  const { view } = await loaded({ totals: { hyxi: 2, growatt: 0 } });
  assert.equal(view.hyxiAlarmCount.value, 2);
  assert.equal(view.currentIncidents.value, 2);
});

// 4. Growatt con 1 activa
test('4: Growatt active=1 muestra 1', async () => {
  const { view } = await loaded({ totals: { hyxi: 0, growatt: 1 } });
  assert.equal(view.growattAlarmCount.value, 1);
  assert.equal(view.currentIncidents.value, 1);
});

// 5. suma e incidentes solo activos
test('5: HYXi=2 + Growatt=1 suma 3; resueltas no cuentan', async () => {
  const { view, sent } = await loaded({ totals: { hyxi: 2, growatt: 1 } });
  assert.equal(view.currentIncidents.value, 3);
  for (const params of sent) assert.equal(params.status, 'active');
});
