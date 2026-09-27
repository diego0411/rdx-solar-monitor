import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { ref, computed, watch, onMounted } from 'vue';

const { descriptor } = parse(readFileSync(new URL('../src/components/PlantEconomics.vue', import.meta.url), 'utf8'));
const code = compileScript(descriptor, { id: 'economics-race-test' }).content
  .replace(/^import .*;$/gm, '').replace('export default', 'return');

const flush = () => new Promise(resolve => setImmediate(resolve));

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

function setup({ apiFetch } = {}) {
  const fetchMock = apiFetch ?? createApiFetch();
  const calls = fetchMock.calls ?? null;
  const fetchFn = fetchMock.apiFetch ?? fetchMock;
  let unmount = null;
  const deps = {
    ref,
    computed,
    watch,
    onMounted() {},
    onBeforeUnmount(cb) { unmount = cb; },
    getMyProfile: async () => ({ profile: { role: 'client_admin' } }),
    apiFetch: fetchFn,
    compensationValue: () => null,
    creditEstimatedValue: () => null,
  };
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps));
  const view = component.setup(
    { plantId: 'p1', period: 'day', selectedDate: '2026-09-01' },
    { expose() {} },
  );
  return { view, calls, unmount: () => unmount?.() };
}

const lastCall = (calls, fragment) => calls.filter(call => call.url.includes(fragment)).at(-1);
const economics = payload => ({ generation_kwh: 42, coverage: { status: 'available' }, ...payload });

test('A) carga normal actualiza estado sin error', async () => {
  const { view, calls } = setup();
  assert.equal(view.loading.value, true);
  lastCall(calls, '/economics?').resolve(economics());
  lastCall(calls, '/energy-tariffs').resolve([]);
  await flush();
  await flush();
  assert.equal(view.summary.value.generation_kwh, 42);
  assert.equal(view.loading.value, false);
  assert.equal(view.error.value, '');
});

test('B) respuesta obsoleta no sobrescribe: gana la carga nueva', async () => {
  const { view, calls } = setup();
  const first = lastCall(calls, '/economics?');
  void view.loadSummary();
  const second = lastCall(calls, '/economics?');
  assert.equal(first.signal.aborted, true);
  first.resolve(economics({ generation_kwh: 'STALE' }));
  await flush();
  await flush();
  assert.equal(view.summary.value, null);
  assert.equal(view.loading.value, true);
  second.resolve(economics({ generation_kwh: 'FRESH' }));
  await flush();
  await flush();
  assert.equal(view.summary.value.generation_kwh, 'FRESH');
  assert.equal(view.loading.value, false);
  assert.equal(view.error.value, '');
});

test('C) catch/finally obsoletos no alteran loading ni error vigentes', async () => {
  const { view, calls } = setup();
  const first = lastCall(calls, '/economics?');
  void view.loadSummary();
  const second = lastCall(calls, '/economics?');
  first.reject(new Error('boom tardío'));
  await flush();
  await flush();
  assert.equal(view.error.value, '');
  assert.equal(view.loading.value, true);
  second.resolve(economics());
  await flush();
  await flush();
  assert.equal(view.loading.value, false);
  assert.equal(view.error.value, '');
});

test('D) unmount cancela la carga y bloquea actualización posterior', async () => {
  const { view, calls, unmount } = setup();
  const pending = lastCall(calls, '/economics?');
  unmount();
  assert.equal(pending.signal.aborted, true);
  pending.resolve(economics());
  await flush();
  await flush();
  assert.equal(view.summary.value, null);
  assert.equal(view.error.value, '');
});

test('E) abort intencional no presenta error visible', async () => {
  const { view, calls } = setup();
  const first = lastCall(calls, '/economics?');
  void view.loadSummary();
  first.reject(new DOMException('aborted', 'AbortError'));
  await flush();
  await flush();
  assert.equal(view.error.value, '');
  assert.equal(view.summary.value, null);
});

test('tarifas: ciclo nuevo invalida al anterior', async () => {
  const { view, calls } = setup();
  const first = lastCall(calls, '/energy-tariffs');
  void view.loadTariffs();
  const second = lastCall(calls, '/energy-tariffs');
  assert.equal(first.signal.aborted, true);
  first.resolve([{ id: 'stale' }]);
  await flush();
  await flush();
  assert.deepEqual(view.tariffs.value, []);
  second.resolve([{ id: 'fresh' }]);
  await flush();
  await flush();
  assert.deepEqual(view.tariffs.value, [{ id: 'fresh' }]);
  assert.equal(view.tariffError.value, '');
});

test('categorías: ciclo nuevo invalida al anterior', async () => {
  const { view, calls } = setup();
  view.distributorChoice.value = 'CRE R.L.';
  void view.loadCategoriesForDistributor();
  await flush();
  calls.find(call => call.url === '/plants/catalog/energy-distributors')
    .resolve([{ id: 'd1', name: 'CRE R.L.' }]);
  await flush();
  await flush();
  const first = lastCall(calls, '/tariff-categories');
  void view.loadCategoriesForDistributor();
  await flush();
  await flush();
  const second = lastCall(calls, '/tariff-categories');
  assert.equal(first.signal.aborted, true);
  first.resolve([{ code: 'STALE', name: 'Obsoleta' }]);
  await flush();
  await flush();
  assert.deepEqual(view.catalogCategories.value, []);
  second.resolve([{ code: 'FRESH', name: 'Vigente' }]);
  await flush();
  await flush();
  assert.deepEqual(view.catalogCategories.value, [{ code: 'FRESH', name: 'Vigente' }]);
});
