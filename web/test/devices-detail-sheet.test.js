import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { ref, computed, watch, nextTick } from 'vue';
import { deviceInCategory, deviceTypeCategoryLabel, deviceTypeLabel, visibleDeviceTypeCategories } from '../src/utils/deviceDisplay.js';
import { useModalEscape, __modalStackReset } from '../src/composables/useModalStack.js';

// UX-05B: a ≤900px el detalle de Dispositivos es un diálogo inferior con
// backdrop, Escape, scroll-lock y foco gestionado (useModalStack sin cambios).
// En desktop el aside conserva su conducta. Sin red ni DOM real.

const source = readFileSync(new URL('../src/views/DevicesView.vue', import.meta.url), 'utf8');
const { descriptor } = parse(source);
const code = compileScript(descriptor, { id: 'devices-sheet-test' }).content
  .replace(/^import .*;?$/gm, '').replace('export default', 'return');

const device = { id: 'd1', name: 'Inversor', serial_number: 'SN1', plant_id: 'p1' };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function setup({ narrow = false } = {}) {
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  const keyListeners = {};
  const matchListeners = new Set();
  const matchMediaCalls = [];
  let matches = narrow;
  const query = {
    get matches() { return matches; },
    addEventListener: (type, fn) => { if (type === 'change') matchListeners.add(fn); },
    removeEventListener: (type, fn) => { if (type === 'change') matchListeners.delete(fn); },
  };
  globalThis.window = {
    addEventListener: (type, fn) => { keyListeners[type] = [...(keyListeners[type] ?? []), fn]; },
    removeEventListener: (type, fn) => { keyListeners[type] = (keyListeners[type] ?? []).filter(f => f !== fn); },
    matchMedia: media => { matchMediaCalls.push(media); return query; },
  };
  const body = { style: {} };
  globalThis.document = {
    body, activeElement: null,
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
  };
  let mountedFn;
  const unmountedFns = [];
  const disposes = [];
  const deps = {
    ref, computed, watch, nextTick,
    onMounted: fn => { mountedFn = fn; },
    onBeforeUnmount: () => {},
    onUnmounted: fn => { unmountedFns.push(fn); },
    apiFetch: async () => [],
    deviceInCategory, deviceTypeCategoryLabel, deviceTypeLabel, visibleDeviceTypeCategories,
    // El composable registra su dispose en el Vue real (sin instancia en el
    // sandbox); se captura aquí para emular el desmontaje de producción.
    useModalEscape: (...args) => { const dispose = useModalEscape(...args); disposes.push(dispose); return dispose; },
  };
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps));
  const view = component.setup({}, { expose() {} });
  return {
    view, body, keyListeners, matchMediaCalls,
    fireChange: value => { matches = value; for (const fn of matchListeners) fn({ matches: value }); },
    keydown: key => { for (const fn of keyListeners.keydown ?? []) fn({ key }); },
    async mount() { mountedFn(); await tick(); await tick(); },
    unmount() { for (const fn of unmountedFns) fn(); for (const dispose of disposes) dispose(); },
    restore() {
      __modalStackReset();
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
    },
  };
}

test('estático: diálogo solo en angosto, capas y desktop intactos', () => {
  assert.match(source, /import \{ useModalEscape \} from '\.\.\/composables\/useModalStack\.js';/);
  assert.match(source, /NARROW_QUERY = '\(max-width: 900px\)'/);
  assert.match(source, /useModalEscape\(sheetActive, closeDetail\)/);
  assert.match(source, /<div v-if="sheetActive" class="detail-backdrop" @click="closeDetail"><\/div>/);
  assert.match(source, /:class="\{ modal: isNarrow \}" :role="isNarrow \? 'dialog' : undefined" :aria-modal="isNarrow \? 'true' : undefined"/);
  assert.match(source, /@click="closeDetail">×<\/button>/);
  assert.match(source, /\.detail-backdrop\{position:fixed;inset:0;z-index:35;/);
  assert.match(source, /\.detail\{position:sticky;top:calc\(var\(--rdx-topbar-height, 46px\) \+ 24px\)\}/);
  assert.match(source, /\.content\.detailed\{grid-template-columns:minmax\(0,1fr\) 300px\}/);
  assert.match(source, /@media\(max-width:900px\)\{\.content\.detailed\{grid-template-columns:1fr\}\.detail\{position:fixed;z-index:40;/);
  // Activadores intactos: fila (clic/Enter) y botón ›; cierre por × y backdrop.
  assert.match(source, /@click="selected = item" @keydown\.enter="selected = item"/);
  assert.match(source, /@click\.stop="selected = item">›<\/button>/);
  // Capas: backdrop bajo el sheet y bajo el resto de overlays.
  const theme = readFileSync(new URL('../src/components/ThemeSwitch.vue', import.meta.url), 'utf8');
  assert.match(theme, /z-index: 45;/);
  const layout = readFileSync(new URL('../src/layouts/AppLayout.vue', import.meta.url), 'utf8');
  assert.match(layout, /z-index: 60;/);
  assert.match(layout, /z-index: 55;/);
});

test('móvil: abrir bloquea scroll, Escape cierra y libera', async () => {
  const h = setup({ narrow: true });
  try {
    await h.mount();
    assert.deepEqual(h.matchMediaCalls, ['(max-width: 900px)']);
    assert.equal(h.view.isNarrow.value, true);
    h.view.selected.value = device;
    await tick(); await tick();
    assert.equal(h.view.sheetActive.value, true);
    assert.equal(h.body.style.overflow, 'hidden');
    assert.equal((h.keyListeners.keydown ?? []).length, 1);
    h.keydown('Escape');
    await tick(); await tick();
    assert.equal(h.view.selected.value, null);
    assert.equal(h.view.sheetActive.value, false);
    assert.ok(!h.body.style.overflow);
    assert.deepEqual(h.keyListeners.keydown ?? [], []);
  } finally { h.restore(); }
});

test('móvil: el foco vuelve al activador al cerrar', async () => {
  const h = setup({ narrow: true });
  try {
    await h.mount();
    let focused = 0;
    globalThis.document.activeElement = { focus() { focused += 1; } };
    h.view.selected.value = device;
    await tick(); await tick();
    h.keydown('Escape');
    await tick(); await tick();
    assert.equal(focused, 1);
  } finally { h.restore(); }
});

test('desktop: sin diálogo, sin bloqueo y Escape no cierra', async () => {
  const h = setup({ narrow: false });
  try {
    await h.mount();
    h.view.selected.value = device;
    await tick(); await tick();
    assert.equal(h.view.sheetActive.value, false);
    assert.ok(!('overflow' in h.body.style));
    assert.deepEqual(h.keyListeners.keydown ?? [], []);
    h.keydown('Escape');
    await tick();
    assert.equal(h.view.selected.value?.id, 'd1');
  } finally { h.restore(); }
});

test('cambio de breakpoint con el panel abierto conserva el detalle', async () => {
  const h = setup({ narrow: false });
  try {
    await h.mount();
    h.view.selected.value = device;
    await tick();
    assert.equal(h.view.sheetActive.value, false);
    h.fireChange(true);
    await tick(); await tick();
    assert.equal(h.view.isNarrow.value, true);
    assert.equal(h.view.sheetActive.value, true);
    assert.equal(h.body.style.overflow, 'hidden');
    h.fireChange(false);
    await tick(); await tick();
    assert.equal(h.view.sheetActive.value, false);
    assert.equal(h.view.selected.value?.id, 'd1');
    assert.ok(!h.body.style.overflow);
  } finally { h.restore(); }
});

test('desmontar libera el listener de matchMedia', async () => {
  const h = setup({ narrow: true });
  try {
    await h.mount();
    h.view.selected.value = device;
    await tick(); await tick();
    h.unmount();
    await tick(); await tick();
    h.fireChange(false);
    await tick();
    assert.equal(h.view.isNarrow.value, true);
    assert.ok(!h.body.style.overflow);
  } finally { h.restore(); }
});
