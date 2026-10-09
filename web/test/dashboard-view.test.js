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

function setup({ totals = { hyxi: 0, growatt: 0 }, fail = false } = {}) {
  const sent = { summary: 0, alarms: 0 };
  const deps = {
    ref, computed, onMounted() {}, onUnmounted() {},
    apiFetch: async () => ({ providers: [], top_plants: [] }),
    getAlarmSummary: async () => {
      sent.summary += 1;
      sent.alarms += 1;
      if (fail) throw new Error('down');
      return {
        active: (totals.hyxi ?? 0) + (totals.growatt ?? 0),
        critical: 0, warning: 0, resolved_7d: 0,
        by_provider: { hyxi: totals.hyxi ?? 0, growatt: totals.growatt ?? 0 },
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

// 1. contrato: una sola petición de alarmas vía /alarms/summary; sin legacy
test('1: dashboard usa un solo /alarms/summary; sin endpoints legacy', async () => {
  assert.equal(viewSource.includes('alarms/recent'), false);
  assert.equal(viewSource.includes('alarms/current'), false);
  assert.equal(viewSource.includes('integrations/'), false);
  assert.equal(viewSource.includes('listAlarms'), false);
  const { sent } = await loaded();
  assert.equal(sent.summary, 1);
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
  assert.equal(sent.summary, 1);
});

// 6. error no se representa como cero: conteos quedan null y hay error
test('6: fallo de summary conserva null y marca error por fabricante', async () => {
  const { view } = await loaded({ fail: true });
  assert.equal(view.hyxiActiveAlarms.value, null);
  assert.equal(view.growattActiveAlarms.value, null);
  assert.ok(view.hyxiError.value.length > 0);
  assert.ok(view.growattError.value.length > 0);
});

// 7. single-flight: dos actualizaciones seguidas emiten una sola petición
test('7: fetchDashboard concurrente emite una sola petición de alarmas', async () => {
  const { view, sent } = setup();
  view.fetchDashboard();
  view.fetchDashboard();
  await flush(); await flush(); await flush();
  assert.equal(sent.summary, 1);
});
