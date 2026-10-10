import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { computed, nextTick, reactive, ref, watch } from 'vue';

// UX-05C D4/D5/D6: drawer móvil como diálogo con foco contenido, una sola
// columna y breadcrumb truncable. Escritorio y useModalStack intactos.

const source = readFileSync(new URL('../src/layouts/AppLayout.vue', import.meta.url), 'utf8');
const { descriptor } = parse(source);
const code = compileScript(descriptor, { id: 'layout-drawer-test' }).content
  .replace(/^import[^;]*;$/gm, '').replace('export default', 'return');

function fakeControl(name) {
  return {
    name, focused: 0, isConnected: true,
    getClientRects: () => [{}],
    focus() { this.focused += 1; globalThis.document.activeElement = this; },
  };
}

function setup({ mobile = false, open = false } = {}) {
  const previousDocument = globalThis.document;
  const previousLocalStorage = globalThis.localStorage;
  globalThis.localStorage = undefined;
  const controls = [fakeControl('close'), fakeControl('dashboard'), fakeControl('logout')];
  const aside = {
    querySelectorAll: () => controls,
    contains: node => node === aside || controls.includes(node),
    getClientRects: () => [{}],
    focused: 0,
    focus() { this.focused += 1; globalThis.document.activeElement = this; },
  };
  const menuButton = { focused: 0, focus() { this.focused += 1; } };
  globalThis.document = { body: { style: {} }, activeElement: null };
  const route = reactive({ name: 'dashboard' });
  const deps = {
    ref, computed, watch, nextTick, onMounted() {}, onUnmounted() {},
    useRouter: () => ({ replace: async () => {} }),
    useRoute: () => route,
    supabase: null,
    getMyProfile: async () => ({}),
    invalidatePlantsCatalog: () => {},
    invalidateDevicesCatalog: () => {},
    ThemeSwitch: 'ThemeSwitch',
  };
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps));
  const view = component.setup({}, { expose() {} });
  view.isMobile.value = mobile;
  view.sidebarRef.value = aside;
  view.menuButtonRef.value = menuButton;
  if (open) view.mobileNavOpen.value = true;
  return {
    view, route, controls, aside, menuButton,
    restore() {
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
      globalThis.localStorage = previousLocalStorage;
    },
  };
}

function tabEvent(shiftKey = false) {
  return {
    key: 'Tab', shiftKey, prevented: false,
    preventDefault() { this.prevented = true; },
  };
}

test('D4 estático: diálogo condicional, trampa local y stack intacto', () => {
  assert.match(source, /:role="isMobile \? 'dialog' : undefined"/);
  assert.match(source, /:aria-modal="isMobile \? 'true' : undefined"/);
  assert.match(source, /:aria-label="isMobile \? 'Menú de navegación' : undefined"/);
  assert.match(source, /<aside ref="sidebarRef"[^>]*@keydown="onDrawerKeydown"/);
  assert.match(source, /function onDrawerKeydown\(event\)/);
  assert.match(source, /drawerControls\(\)/);
  // Sin listeners globales nuevos: un único keydown (Escape) en ventana.
  assert.equal([...source.matchAll(/window\.addEventListener\('keydown'/g)].length, 1);
  assert.ok(!source.includes('useModalEscape'), 'drawer fuera de la pila de modales');
  const stack = readFileSync(new URL('../src/composables/useModalStack.js', import.meta.url), 'utf8');
  assert.ok(stack.includes('drawerOpen'), 'precedencia del drawer conservada');
  assert.ok(!stack.includes('primary-sidebar'), 'composable sin cambios para el drawer');
  // Cierres y retorno existentes intactos.
  assert.match(source, /window\.addEventListener\('keydown', onGlobalKeydown\)/);
  assert.match(source, /@click="closeMobileNav\(false\)"><\/div>/);
  assert.match(source, /if \(mobileNavOpen\.value\) closeMobileNav\(false\)/);
  assert.match(source, /menuButtonRef\.value\?\.focus\?\.\(\)/);
});

test('D4 conducta: Tab envuelve dentro del drawer abierto', () => {
  const h = setup({ mobile: true, open: true });
  try {
    const [first, , last] = h.controls;
    globalThis.document.activeElement = last;
    const forward = tabEvent(false);
    h.view.onDrawerKeydown(forward);
    assert.equal(forward.prevented, true);
    assert.equal(first.focused, 1);
    assert.equal(globalThis.document.activeElement, first);
    const backward = tabEvent(true);
    h.view.onDrawerKeydown(backward);
    assert.equal(backward.prevented, true);
    assert.equal(last.focused, 1);
    // Foco externo se redirige al primer control.
    globalThis.document.activeElement = {};
    const outside = tabEvent(false);
    h.view.onDrawerKeydown(outside);
    assert.equal(outside.prevented, true);
    assert.equal(first.focused, 2);
    // Tab intermedio no se intercepta.
    globalThis.document.activeElement = h.controls[1];
    const middle = tabEvent(false);
    h.view.onDrawerKeydown(middle);
    assert.equal(middle.prevented, false);
  } finally { h.restore(); }
});

test('D4 conducta: trampa inactiva en desktop o con drawer cerrado', () => {
  const closed = setup({ mobile: true, open: false });
  try {
    const event = tabEvent(false);
    closed.view.onDrawerKeydown(event);
    assert.equal(event.prevented, false);
    closed.view.onDrawerKeydown({ key: 'Enter' });
  } finally { closed.restore(); }
  const desktop = setup({ mobile: false, open: true });
  try {
    const event = tabEvent(false);
    desktop.view.onDrawerKeydown(event);
    assert.equal(event.prevented, false);
  } finally { desktop.restore(); }
});

test('D4 conducta: apertura, Escape, navegación y retorno de foco', async () => {
  const h = setup({ mobile: true });
  try {
    h.view.openMobileNav();
    await nextTick();
    assert.equal(h.view.mobileNavOpen.value, true);
    assert.equal(h.aside.focused, 1);
    assert.equal(globalThis.document.body.style.overflow, 'hidden');
    h.view.onGlobalKeydown({ key: 'Escape' });
    assert.equal(h.view.mobileNavOpen.value, false);
    assert.equal(h.menuButton.focused, 1);
    assert.ok(!globalThis.document.body.style.overflow, 'restaura el overflow previo');
    h.view.openMobileNav();
    await nextTick();
    h.route.name = 'devices';
    await nextTick();
    assert.equal(h.view.mobileNavOpen.value, false);
    assert.equal(h.menuButton.focused, 1, 'navegar no mueve el foco de nuevo');
  } finally { h.restore(); }
});

test('D6 estático: drawer en una columna, agrupaciones e iconos intactos', () => {
  const styles = descriptor.styles.map(block => block.content).join('\n');
  const mobile = styles.slice(styles.indexOf('@media (max-width: 720px)'));
  assert.match(mobile, /\.app-shell \.sidebar nav \{\s*grid-template-columns: 1fr;\s*\}/);
  assert.match(mobile, /\.app-shell \.sidebar \.sidebar-account \{\s*grid-template-columns: 1fr;\s*\}/);
  assert.ok(!mobile.includes('display: contents'), 'sin retícula de dos columnas');
  assert.ok(!mobile.includes('repeat(2,') && !mobile.includes('1fr auto'), 'sin 2 columnas ni cuenta lateral');
  const global = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(global, /\.sidebar nav \{ display: grid;/);
  for (const label of ['Monitoreo', 'Operaciones', 'Dashboard', 'Solicitudes de materiales']) {
    assert.ok(source.includes(`<span>${label}</span>`), `conserva ${label}`);
  }
  assert.ok(source.includes('class="nav-icon"'), 'iconos intactos');
});

test('D5 estático y conducta: truncado con texto completo accesible', () => {
  assert.match(source, /<span class="crumb-page" :title="breadcrumb\.label">\{\{ breadcrumb\.label \}\}<\/span>/);
  const styles = descriptor.styles.map(block => block.content).join('\n');
  assert.match(styles, /\.crumb-page \{\s*color: var\(--rdx-text-strong\);\s*font-weight: 700;\s*min-width: 0;\s*overflow: hidden;\s*text-overflow: ellipsis;\s*\}/);
  assert.match(source, /<nav v-if="breadcrumb\.section" class="breadcrumb" aria-label="Ubicación actual">/);
  const h = setup({ routeName: undefined });
  try {
    h.route.name = 'operations';
    assert.equal(h.view.breadcrumb.value.label, 'Solicitudes de materiales');
  } finally { h.restore(); }
});
