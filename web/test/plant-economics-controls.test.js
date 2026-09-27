import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { computed, reactive, ref, watch } from 'vue';

const flush = () => new Promise(resolve => setImmediate(resolve));

function compileSetup(path, id) {
  const { descriptor } = parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  const code = compileScript(descriptor, { id }).content.replace(/^import .*;$/gm, '')
    .replace('export default', 'return');
  return code;
}

const economicsCode = compileSetup('../src/components/PlantEconomics.vue', 'economics-controls-test');
const detailCode = compileSetup('../src/views/PlantDetailView.vue', 'detail-controls-test');

function createApiFetch() {
  const calls = [];
  const apiFetch = (url, options = {}) => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    calls.push({ url, signal: options.signal ?? null, resolve, reject });
    return promise;
  };
  return { calls, apiFetch };
}

function setupEconomics({ period = 'day', selectedDate = '2026-09-01' } = {}) {
  const { calls, apiFetch } = createApiFetch();
  const emitted = [];
  const props = reactive({ plantId: 'p1', period, selectedDate });
  let unmount = null;
  const deps = {
    ref,
    computed,
    watch,
    onMounted() {},
    onBeforeUnmount(cb) { unmount = cb; },
    getMyProfile: async () => ({ profile: { role: 'client_admin' } }),
    apiFetch,
    compensationValue: () => null,
    creditEstimatedValue: () => null,
  };
  const component = new Function(...Object.keys(deps), economicsCode)(...Object.values(deps));
  const view = component.setup(props, { expose() {}, emit: (...args) => emitted.push(args) });
  return { view, calls, emitted, props, unmount: () => unmount?.() };
}

function setupDetail() {
  const stub = {};
  const deps = {
    ref,
    watch,
    computed,
    useRoute: () => ({ params: { id: 'plant-1' } }),
    apiFetch: () => new Promise(() => {}),
    deviceDisplayName: () => '',
    PlantPowerCurve: stub,
    PlantEnergyHistory: stub,
    PlantEnergyFlow: stub,
    PlantEconomics: stub,
    PlantInstallationDetails: stub,
  };
  const component = new Function(...Object.keys(deps), detailCode)(...Object.values(deps));
  return component.setup({}, { expose() {} });
}

const lastEconomics = calls => calls.filter(call => call.url.includes('/economics?')).at(-1);

test('1. control economico usa period=day por defecto', async () => {
  const { calls } = setupEconomics();
  await flush();
  assert.ok(lastEconomics(calls).url.includes('period=day'));
});

test('2. padre inicia economicDate valido igual a la fecha actual', () => {
  const view = setupDetail();
  assert.equal(view.economicPeriod.value, 'day');
  assert.match(view.economicDate.value, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(view.economicDate.value, view.historyDate.value);
  assert.equal(view.historyPeriod.value, 'day');
});

test('3-6. cada periodo genera su carga con el period correspondiente', async () => {
  for (const period of ['day', 'week', 'month', 'year']) {
    const { calls, props } = setupEconomics();
    await flush();
    props.period = period;
    await flush();
    await flush();
    assert.ok(
      lastEconomics(calls).url.includes(`period=${period}`),
      `period=${period} en ${lastEconomics(calls).url}`,
    );
  }
});

test('7. cambio de fecha actualiza startTime economico', async () => {
  const { calls, props } = setupEconomics({ selectedDate: '2026-09-01' });
  await flush();
  props.selectedDate = '2026-09-20';
  await flush();
  await flush();
  assert.ok(lastEconomics(calls).url.includes('startTime=2026-09-20'));
});

test('8. cambiar economicPeriod NO cambia historyPeriod', () => {
  const view = setupDetail();
  view.economicPeriod.value = 'week';
  assert.equal(view.historyPeriod.value, 'day');
  assert.equal(view.economicPeriod.value, 'week');
});

test('9. cambiar historyPeriod NO cambia economicPeriod', () => {
  const view = setupDetail();
  const initialDate = view.economicDate.value;
  view.historyPeriod.value = 'month';
  view.historyDate.value = '2026-08-15';
  assert.equal(view.economicPeriod.value, 'day');
  assert.equal(view.economicDate.value, initialDate);
});

test('10. controles emiten updates y recargan con period+fecha', async () => {
  const { view, calls, emitted, props } = setupEconomics();
  await flush();
  view.selectPeriod('year');
  assert.deepEqual(emitted.at(-1), ['update:period', 'year']);
  view.updateSelectedDate({ target: { value: '2026-09-20' } });
  assert.deepEqual(emitted.at(-1), ['update:selectedDate', '2026-09-20']);
  props.period = 'year';
  props.selectedDate = '2026-09-20';
  await flush();
  await flush();
  const url = lastEconomics(calls).url;
  assert.ok(url.includes('period=year'), url);
  assert.ok(url.includes('startTime=2026-09-20'), url);
});

test('periodos exponen las cuatro opciones Dia/Semana/Mes/Año', () => {
  const { view } = setupEconomics();
  assert.deepEqual(view.periods.map(item => item.key), ['day', 'week', 'month', 'year']);
  assert.deepEqual(view.periods.map(item => item.label), ['Día', 'Semana', 'Mes', 'Año']);
});
