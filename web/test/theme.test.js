import test from 'node:test';
import assert from 'node:assert/strict';

// Contrato observable de web/src/composables/useTheme.js con entorno
// inyectado vía globales (localStorage/matchMedia/document/window).
// Módulo fresco por caso con query string (estado singleton por módulo).

function setup({ stored = null, systemDark = false } = {}) {
  const store = new Map(stored ? [['rdx.theme', stored]] : []);
  const writes = [];
  const attrs = new Map();
  const metaAttrs = new Map([['content', '#174d3c']]);
  const listeners = new Set();
  const events = [];
  let currentSystemDark = systemDark;

  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); writes.push([key, String(value)]); },
  };
  globalThis.matchMedia = () => ({
    get matches() { return currentSystemDark; },
    addEventListener: (type, fn) => { if (type === 'change') listeners.add(fn); },
    addListener: fn => listeners.add(fn),
  });
  globalThis.document = {
    documentElement: undefined,
    querySelector: () => ({ setAttribute: (k, v) => metaAttrs.set(k, v) }),
    createElement: () => ({ setAttribute: () => {}, appendChild: () => {} }),
  };
  globalThis.document.documentElement = {
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: k => attrs.delete(k),
  };
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
  globalThis.window = { dispatchEvent: event => { events.push(event); return true; } };

  return {
    attrs, metaAttrs, writes, events,
    setSystemDark: value => {
      currentSystemDark = value;
      for (const fn of listeners) fn({ matches: value });
    },
    store,
  };
}

const fresh = n => import(`../src/composables/useTheme.js?case=${n}`);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('1: sin preferencia, light por defecto sin atributo ni escritura', async () => {
  setup();
  const { useTheme, THEME_STORAGE_KEY } = await fresh(1);
  assert.equal(THEME_STORAGE_KEY, 'rdx.theme');
  const { preference, effectiveTheme } = useTheme();
  assert.equal(preference.value, 'light');
  assert.equal(effectiveTheme.value, 'light');
});

test('2: valor almacenado inválido equivale a light', async () => {
  setup({ stored: 'midnight' });
  const { useTheme } = await fresh(2);
  const { preference, effectiveTheme } = useTheme();
  assert.equal(preference.value, 'light');
  assert.equal(effectiveTheme.value, 'light');
});

test('3: dark manual aplica data-theme, meta y persiste', async () => {
  const env = setup();
  const { useTheme } = await fresh(3);
  const { preference, effectiveTheme, setThemePreference } = useTheme();
  assert.equal(setThemePreference('dark'), true);
  assert.equal(preference.value, 'dark');
  assert.equal(effectiveTheme.value, 'dark');
  await tick();
  assert.equal(env.attrs.get('data-theme'), 'dark');
  assert.equal(env.metaAttrs.get('content'), '#0e1512');
  assert.deepEqual(env.writes, [['rdx.theme', 'dark']]);
  assert.ok(env.events.some(event => event.type === 'rdx:theme' && event.detail.theme === 'dark'));
});

test('4: auto sigue al sistema y reacciona a sus cambios', async () => {
  const env = setup({ systemDark: true });
  const { useTheme } = await fresh(4);
  const { effectiveTheme, setThemePreference } = useTheme();
  setThemePreference('auto');
  assert.equal(effectiveTheme.value, 'dark');
  await tick();
  assert.equal(env.attrs.get('data-theme'), 'dark');
  env.setSystemDark(false);
  assert.equal(effectiveTheme.value, 'light');
  await tick();
  assert.ok(!env.attrs.has('data-theme'));
});

test('5: preferencia inválida se rechaza sin cambios', async () => {
  const env = setup();
  const { useTheme } = await fresh(5);
  const { preference, setThemePreference } = useTheme();
  assert.equal(setThemePreference('neon'), false);
  assert.equal(preference.value, 'light');
  assert.deepEqual(env.writes, []);
});

test('6: dark almacenado se restaura al iniciar (FOUC + init coherentes)', async () => {
  const env = setup({ stored: 'dark' });
  const { useTheme } = await fresh(6);
  const { preference, effectiveTheme } = useTheme();
  assert.equal(preference.value, 'dark');
  assert.equal(effectiveTheme.value, 'dark');
  assert.equal(env.attrs.get('data-theme'), 'dark');
});
