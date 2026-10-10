import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { computed, ref, nextTick } from 'vue';

const source = readFileSync(new URL('../src/components/ThemeSwitch.vue', import.meta.url), 'utf8');
const { descriptor } = parse(source);
const code = compileScript(descriptor, { id: 'theme-switch-test' }).content
  .replace(/^import .*;?$/gm, '').replace('export default', 'return');

function setup(preference = 'light', width = 390, anchor = { right: 374, top: 20, bottom: 56 }) {
  const previousDocument = globalThis.document, previousWindow = globalThis.window;
  const listeners = new Map();
  const target = name => ({
    addEventListener(type, fn, capture) { listeners.set(`${name}:${type}`, { fn, capture }); },
    removeEventListener(type, fn, capture) {
      const current = listeners.get(`${name}:${type}`);
      assert.equal(current?.fn, fn);
      assert.equal(current?.capture, capture);
      listeners.delete(`${name}:${type}`);
    },
  });
  globalThis.document = target('document');
  globalThis.window = { ...target('window'), innerWidth: width, innerHeight: 800 };
  let mounted, unmount, focused = null;
  const themePreference = ref(preference), changes = [];
  const deps = {
    computed, ref, nextTick, useId: () => 'test',
    onMounted: fn => { mounted = fn; },
    onBeforeUnmount: fn => { unmount = fn; },
    useTheme: () => ({
      preference: themePreference,
      setThemePreference(value) { changes.push(value); themePreference.value = value; },
    }),
  };
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps));
  const view = component.setup({}, { expose() {} });
  const trigger = { focus() { focused = 'trigger'; }, getBoundingClientRect: () => anchor };
  const options = ['light', 'dark', 'auto'].map(value => ({ focus() { focused = value; } }));
  const menu = {
    getBoundingClientRect: () => ({ width: 176, height: 130 }),
    querySelectorAll: () => options,
    contains: node => options.includes(node) || node === menu,
  };
  view.root.value = { contains: node => node === trigger };
  view.trigger.value = trigger;
  view.menu.value = menu;
  mounted();
  return {
    view, changes, listeners, trigger, options,
    get focused() { return focused; },
    restore() {
      unmount();
      assert.equal(listeners.size, 0);
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    },
  };
}

function key(key) {
  return {
    key, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
  };
}

test('los tres modos abren en la opción seleccionada; elegir cierra y devuelve el foco', async () => {
  for (const [index, value] of ['light', 'dark', 'auto'].entries()) {
    const h = setup(value);
    try {
      assert.equal(h.view.isOpen.value, false);
      await h.view.openMenu();
      assert.equal(h.view.isOpen.value, true);
      assert.equal(h.focused, value);
      assert.equal(h.view.focusedIndex.value, index);
      const next = ['light', 'dark', 'auto'][(index + 1) % 3];
      h.view.selectTheme(next);
      assert.deepEqual(h.changes, [next]);
      assert.equal(h.view.activeTheme.value.value, next);
      assert.equal(h.view.isOpen.value, false);
      assert.equal(h.focused, 'trigger');
    } finally { h.restore(); }
  }
});

test('flechas, Home y End navegan con wrap; Escape cierra sin cambiar tema', async () => {
  const h = setup();
  try {
    const down = key('ArrowDown');
    h.view.onTriggerKeydown(down);
    await nextTick();
    assert.equal(down.prevented, true);
    assert.equal(h.focused, 'light');
    h.view.onMenuKeydown(key('ArrowUp'));
    assert.equal(h.focused, 'auto');
    h.view.onMenuKeydown(key('ArrowDown'));
    assert.equal(h.focused, 'light');
    h.view.onMenuKeydown(key('End'));
    assert.equal(h.focused, 'auto');
    h.view.onMenuKeydown(key('Home'));
    assert.equal(h.focused, 'light');
    const escape = key('Escape');
    h.view.onMenuKeydown(escape);
    assert.equal(escape.prevented, true);
    assert.equal(escape.stopped, true);
    assert.equal(h.view.isOpen.value, false);
    assert.equal(h.focused, 'trigger');
    assert.deepEqual(h.changes, []);
    h.view.onTriggerKeydown(key('ArrowUp'));
    await nextTick();
    assert.equal(h.focused, 'auto');
  } finally { h.restore(); }
});

test('Tab no atrapa el foco; Enter y Espacio conservan la activación nativa', async () => {
  const h = setup();
  try {
    await h.view.openMenu();
    for (const value of ['Enter', ' ']) {
      const event = key(value);
      h.view.onMenuKeydown(event);
      assert.equal(event.prevented, false);
    }
    const tab = key('Tab');
    h.view.onMenuKeydown(tab);
    assert.equal(tab.prevented, false);
    assert.equal(h.view.isOpen.value, false);
    assert.equal(h.focused, 'trigger');
  } finally { h.restore(); }
});

test('clic/foco externos cierran sin robar foco; interacción interna conserva el menú', async () => {
  const h = setup();
  try {
    await h.view.openMenu();
    h.listeners.get('document:pointerdown').fn({ target: h.options[1] });
    h.listeners.get('document:focusin').fn({ target: h.trigger });
    assert.equal(h.view.isOpen.value, true);
    h.listeners.get('document:pointerdown').fn({ target: {} });
    assert.equal(h.view.isOpen.value, false);
    assert.equal(h.focused, 'light');
    await h.view.openMenu();
    h.listeners.get('document:focusin').fn({ target: {} });
    assert.equal(h.view.isOpen.value, false);
  } finally { h.restore(); }
});

test('el menú cabe en 390, 720, 900 y 1200px y se abre arriba si no hay espacio abajo', async () => {
  for (const width of [390, 720, 900, 1200]) {
    for (const anchor of [
      { right: width - 16, top: 20, bottom: 56 },
      { right: 52, top: 740, bottom: 776 },
    ]) {
      const h = setup('light', width, anchor);
      try {
        await h.view.openMenu();
        const left = parseFloat(h.view.menuPosition.value.left);
        const top = parseFloat(h.view.menuPosition.value.top);
        assert.ok(left >= 8 && left + 176 <= width - 8);
        assert.ok(top >= 8 && top + 130 <= 792);
        if (anchor.top === 740) assert.ok(top + 130 < anchor.top);
      } finally { h.restore(); }
    }
  }
});

test('resize/scroll cierran y una apertura cancelada no mueve el foco después de nextTick', async () => {
  const h = setup();
  try {
    h.view.toggleMenu();
    h.view.toggleMenu();
    await nextTick();
    assert.equal(h.view.isOpen.value, false);
    assert.equal(h.focused, null);
    for (const type of ['resize', 'scroll']) {
      await h.view.openMenu();
      h.listeners.get(`window:${type}`).fn({ target: {} });
      assert.equal(h.view.isOpen.value, false);
    }
  } finally { h.restore(); }
});

test('semántica de menú radio, icono por preferencia y popup fuera del flujo del encabezado', () => {
  assert.match(descriptor.template.content, /aria-haspopup="menu"/);
  assert.match(descriptor.template.content, /:aria-expanded="String\(isOpen\)"/);
  assert.match(descriptor.template.content, /:aria-controls="menuId"/);
  assert.match(descriptor.template.content, /<Teleport to="body">/);
  assert.match(descriptor.template.content, /role="menuitemradio"/);
  assert.match(descriptor.template.content, /:aria-checked="String\(themePreference === option.value\)"/);
  assert.match(descriptor.template.content, /@focus="focusedIndex = index"/);
  assert.match(descriptor.template.content, /v-if="themePreference === 'light'"/);
  assert.match(descriptor.template.content, /v-else-if="themePreference === 'dark'"/);
  assert.match(descriptor.styles[0].content, /position: fixed;/);
});
