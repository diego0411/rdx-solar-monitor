import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { compile } from '@vue/compiler-dom';
import * as Vue from 'vue';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };

function setup(name, extras = {}) {
  const calls = [], alarmCalls = [], mounted = [], unmounted = [], timers = [];
  const source = readFileSync(new URL(`../src/views/${name}.vue`, import.meta.url), 'utf8');
  const { descriptor } = parse(source);
  const script = compileScript(descriptor, { id: name }).content
    .replace(/^import .*;$/gm, '').replace('export default', 'return');
  const deps = {
    ref: Vue.ref, computed: Vue.computed, watch: Vue.watch, nextTick: Vue.nextTick,
    onMounted: fn => mounted.push(fn), onUnmounted: fn => unmounted.push(fn),
    apiFetch(path, options) { const task = deferred(); calls.push({ path, options, ...task }); return task.promise; },
    getAlarmSummary(options) { const task = deferred(); alarmCalls.push({ options, ...task }); return task.promise; },
    setInterval(fn, ms) { timers.push({ fn, ms }); return 1; }, clearInterval() {},
    ...extras,
  };
  const component = new Function(...Object.keys(deps), script)(...Object.values(deps));
  const scope = Vue.effectScope();
  const view = scope.run(() => component.setup({}, { expose() {} }));
  const render = new Function('Vue', compile(descriptor.template.content, { mode: 'function' }).code)({
    ...Vue, withDirectives: vnode => vnode, resolveComponent: name => name,
  });
  return { view, calls, alarmCalls, timers, mount: () => mounted.forEach(fn => { void fn(); }),
    stop() { unmounted.forEach(fn => fn()); scope.stop(); }, render: () => render(Vue.proxyRefs(view), []) };
}

function alarmSummary(byProvider) {
  const hyxi = byProvider.hyxi ?? 0;
  const growatt = byProvider.growatt ?? 0;
  return { active: hyxi + growatt, critical: 0, warning: 0, resolved_7d: 0, by_provider: { hyxi, growatt } };
}

test('Dashboard renders summary before alarms; alarms failure cannot block summary', async t => {
  const h = setup('DashboardView'); t.after(h.stop);
  h.mount();
  assert.equal(h.calls.length, 1);
  assert.equal(h.alarmCalls.length, 1);
  h.calls[0].resolve({ total_plants: 3, today_generation_kwh: 0 });
  await flush();
  assert.equal(h.view.loading.value, false);
  assert.equal(h.view.summary.value.today_generation_kwh, 0);
  assert.equal(h.view.growattLoading.value, true);
  assert.equal(h.view.hyxiLoading.value, true);
  h.alarmCalls[0].reject(new Error('alarms unavailable'));
  await flush();
  assert.ok(h.view.growattError.value);
  assert.ok(h.view.hyxiError.value);
  assert.equal(h.view.growattActiveAlarms.value, null);
  assert.equal(h.view.hyxiActiveAlarms.value, null);
  assert.equal(h.view.error.value, '');
  assert.equal(h.view.summary.value.total_plants, 3);
});

test('Dashboard renders alarm counts from a single summary', async t => {
  const h = setup('DashboardView'); t.after(h.stop);
  h.mount();
  h.calls[0].resolve({ total_plants: 3 });
  h.alarmCalls[0].resolve(alarmSummary({ hyxi: 0, growatt: 2 }));
  await flush();
  assert.equal(h.view.growattLoading.value, false);
  assert.equal(h.view.hyxiLoading.value, false);
  assert.equal(h.view.growattAlarmCount.value, 2);
  assert.equal(h.view.hyxiAlarmCount.value, 0);
  assert.equal(h.view.currentIncidents.value, 2);
});

test('60 second refresh keeps each source independent, prevents overlaps and preserves last good data', async t => {
  const h = setup('DashboardView'); t.after(h.stop); h.mount();
  assert.equal(h.timers[0].ms, 60000);
  assert.equal(h.calls.length, 1);
  assert.equal(h.alarmCalls.length, 1);
  h.timers[0].fn();
  assert.equal(h.calls.length, 1); // summary sigue pendiente, no se pide dos veces.
  assert.equal(h.alarmCalls.length, 1); // alarmas siguen pendientes, no se piden dos veces.
  h.calls[0].resolve({ total_plants: 1 });
  h.alarmCalls[0].resolve(alarmSummary({ hyxi: 0, growatt: 1 }));
  await flush();
  assert.equal(h.view.growattAlarmCount.value, 1);
  h.timers[0].fn();
  assert.equal(h.calls.length, 2); // summary refresca.
  assert.equal(h.alarmCalls.length, 2); // alarmas refrescan en una sola petición.
  assert.equal(h.view.loading.value, false);
  h.calls[1].reject(new Error('summary failure'));
  h.alarmCalls[1].reject(new Error('alarms failure'));
  await flush();
  assert.equal(h.view.summary.value.total_plants, 1);
  assert.equal(h.view.growattAlarmCount.value, 1);
  assert.equal(h.view.hyxiAlarmCount.value, 0);
  assert.ok(h.view.refreshError.value);
  assert.ok(h.view.growattError.value);
  assert.ok(h.view.hyxiError.value);
  h.stop();
  assert.ok(h.calls.every(call => call.options.signal.aborted));
});

function mapSetup(t) {
  let creations = 0;
  const map = { invalidateSize() {}, fitBounds() {}, setView() {}, remove() {} };
  const layer = { addTo() { return this; }, clearLayers() {} };
  const element = () => ({ style: {}, append() {}, addEventListener() {} });
  const h = setup('PlantMapView', {
    useRouter: () => ({ resolve: () => ({ href: '/' }) }), rdxColor: () => '#000',
    useTheme: () => ({ effectiveTheme: Vue.ref('light') }),
    document: { createElement: element },
    console: { error() {} },
    L: { map() { creations++; return map; }, tileLayer: () => layer, layerGroup: () => layer,
      circleMarker: () => ({ bindPopup() {}, addTo() {} }), latLngBounds: value => value },
  });
  h.view.mapElement.value = {};
  t.after(h.stop);
  h.mount();
  return { ...h, creations: () => creations };
}
const storedPlants = [{ id: 'p', name: 'Real', latitude: 0, longitude: 0, status: 'online' },
  { id: 'missing', latitude: null, longitude: null }];

test('map is created from plants before overview, then enriched without another request/map', async t => {
  const h = mapSetup(t);
  assert.equal(h.calls.length, 2);
  h.calls.find(call => call.path === '/plants').resolve(storedPlants);
  await flush();
  assert.equal(h.creations(), 1);
  assert.equal(h.view.loading.value, false);
  assert.equal(h.view.plantsWithCoords.value.length, 1);
  assert.equal(h.view.plants.value[0].current_power_w, null);
  h.calls.find(call => call.path === '/plants/overview').resolve([{ id: 'p', current_power_w: 0, today_generation_kwh: 0 }]);
  await flush();
  assert.equal(h.view.plants.value[0].current_power_w, 0);
  assert.equal(h.creations(), 1);
  assert.equal(h.calls.length, 2);
});

test('overview may arrive first or fail without blocking basic map data', async t => {
  for (const fail of [false, true]) {
    const h = mapSetup(t);
    const overview = h.calls.find(call => call.path === '/plants/overview');
    if (fail) overview.reject(new Error('unavailable'));
    else overview.resolve([{ id: 'p', current_power_w: 25 }]);
    await flush();
    assert.equal(h.creations(), 0);
    h.calls.find(call => call.path === '/plants').resolve(storedPlants);
    await flush();
    assert.equal(h.creations(), 1);
    assert.equal(h.view.error.value, '');
    assert.equal(h.view.plants.value[0].current_power_w, fail ? null : 25);
  }
});

test('detail mounts both history sections while overview is pending and keeps them after completion', async t => {
  const h = setup('PlantDetailView', { useRoute: () => ({ params: { id: 'p' } }),
    deviceDisplayName: () => '', PlantPowerCurve: {}, PlantEnergyHistory: {}, PlantEnergyFlow: {},
    PlantEconomics: {}, PlantInstallationDetails: {} });
  t.after(h.stop);
  function types(node, result = []) {
    if (node?.type) result.push(node.type);
    if (Array.isArray(node?.children)) node.children.forEach(child => types(child, result));
    return result;
  }
  const before = types(h.render());
  assert.equal(h.view.loading.value, true);
  assert.equal(before.filter(type => type === 'PlantPowerCurve').length, 1);
  assert.equal(before.filter(type => type === 'PlantEnergyHistory').length, 1);
  h.calls[0].resolve({ plant: { timezone: 'America/La_Paz' }, energy: {}, realtime: {}, devices: [] });
  await flush();
  assert.equal(h.view.loading.value, false);
  assert.equal(types(h.render()).filter(type => type === 'PlantPowerCurve').length, 1);
  assert.equal(h.calls.length, 1);
});
