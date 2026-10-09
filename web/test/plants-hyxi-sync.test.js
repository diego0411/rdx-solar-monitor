import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { compile } from '@vue/compiler-dom';
import * as Vue from 'vue';

const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const source = readFileSync(new URL('../src/views/PlantsView.vue', import.meta.url), 'utf8');
const { descriptor } = parse(source);
const script = compileScript(descriptor, { id: 'plants-hyxi-sync-test' }).content
  .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?/gm, '').replace('export default', 'return');
const render = new Function('Vue', compile(descriptor.template.content, { mode: 'function' }).code)({
  ...Vue, withDirectives: vnode => vnode, resolveComponent: name => name,
});

function setup(role) {
  const calls = [], mounted = [], unmounted = [], invalidated = [];
  const deps = {
    ref: Vue.ref, computed: Vue.computed, watch: Vue.watch,
    onMounted: fn => mounted.push(fn), onUnmounted: fn => unmounted.push(fn),
    apiFetch(path, options) { const task = deferred(); calls.push({ path, options, ...task }); return task.promise; },
    getMyProfile: async () => ({ profile: { role } }),
    invalidatePlantsCatalog: () => { invalidated.push(true); },
  };
  const component = new Function(...Object.keys(deps), script)(...Object.values(deps));
  const scope = Vue.effectScope();
  const view = scope.run(() => component.setup({}, { expose() {} }));
  return { view, calls, invalidated, mount: () => mounted.forEach(fn => { void fn(); }),
    stop() { unmounted.forEach(fn => fn()); scope.stop(); }, render: () => render(Vue.proxyRefs(view), []) };
}

function texts(node, result = []) {
  if (typeof node === 'string' || typeof node === 'number') result.push(String(node));
  else if (Array.isArray(node)) node.forEach(child => texts(child, result));
  else if (node && typeof node === 'object') texts(node.children, result);
  return result;
}

async function mountWithRole(t, role) {
  const h = setup(role); t.after(h.stop);
  h.mount();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].path, '/plants/overview');
  h.calls[0].resolve([]);
  await flush();
  await flush();
  assert.equal(h.view.loading.value, false);
  return h;
}

test('1-3. solo rdx_admin ve Sincronizar detalles HYXi', async t => {
  for (const [role, visible] of [['rdx_admin', true], ['client_admin', false], ['client_user', false]]) {
    const h = await mountWithRole(t, role);
    const content = texts(h.render()).join(' ');
    assert.equal(content.includes('Sincronizar detalles HYXi'), visible, role);
    assert.equal(h.view.isRdxAdmin.value, visible);
  }
});

test('4-5. un clic hace un POST y el segundo concurrente no duplica', async t => {
  const h = await mountWithRole(t, 'rdx_admin');
  const first = h.view.syncHyxiDetails();
  const second = h.view.syncHyxiDetails();
  assert.equal(h.view.syncingDetails.value, true);
  assert.equal(h.calls.filter(call => call.path === '/integrations/hyxi/sync/plant-details').length, 1);
  const call = h.calls.find(call => call.path === '/integrations/hyxi/sync/plant-details');
  assert.equal(call.options.method, 'POST');
  call.resolve({ provider: 'hyxi', fetched: 13, updated: 13, failed: 0 });
  await flush();
  h.calls.filter(call => call.path === '/plants/overview').at(-1).resolve([]);
  await first;
  await second;
  await flush();
  assert.equal(h.calls.filter(call => call.path === '/integrations/hyxi/sync/plant-details').length, 1);
});

test('6. muestra updated/failed reales y refresca plantas tras éxito', async t => {
  const h = await mountWithRole(t, 'rdx_admin');
  const pending = h.view.syncHyxiDetails();
  h.calls.find(call => call.path === '/integrations/hyxi/sync/plant-details')
    .resolve({ provider: 'hyxi', fetched: 13, updated: 11, failed: 2 });
  await flush();
  h.calls.filter(call => call.path === '/plants/overview').at(-1).resolve([]);
  await pending;
  await flush();
  assert.match(h.view.syncMessage.value, /11 actualizadas, 2 con error/);
  assert.equal(h.view.syncFailed.value, true);
  assert.equal(h.calls.filter(call => call.path === '/plants/overview').length, 2);
  assert.equal(h.invalidated.length, 1);
});

test('7. fallo de red muestra error sin endpoint real', async t => {
  const h = await mountWithRole(t, 'rdx_admin');
  const pending = h.view.syncHyxiDetails();
  h.calls.find(call => call.path === '/integrations/hyxi/sync/plant-details')
    .reject(Object.assign(new Error('down'), { status: 502 }));
  await pending;
  await flush();
  assert.match(h.view.syncMessage.value, /No se pudieron sincronizar/);
  assert.equal(h.view.syncFailed.value, true);
  assert.equal(h.view.syncingDetails.value, false);
});
