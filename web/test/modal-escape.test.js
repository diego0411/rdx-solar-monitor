import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nextTick, ref } from 'vue';
import { useModalEscape, __modalStackReset } from '../src/composables/useModalStack.js';

// UX-03C2A: Escape cierra solo el modal superior; scroll-lock con conteo;
// convivencia con drawer; limpieza. Sin DOM real (fakes mínimos).

function fakes({ drawer = false, overflow = '' } = {}) {
  const listeners = {};
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = {
    addEventListener: (type, fn) => { listeners[type] = [...(listeners[type] ?? []), fn]; },
    removeEventListener: (type, fn) => { listeners[type] = (listeners[type] ?? []).filter(f => f !== fn); },
  };
  globalThis.document = {
    body: { style: { overflow } },
    activeElement: null,
    querySelector: sel => (drawer && sel === '.app-shell.nav-open' ? {} : null),
    querySelectorAll: () => [],
    getElementById: () => null,
  };
  const keydown = event => { for (const fn of listeners.keydown ?? []) fn(event); };
  return {
    listeners, keydown,
    restore() {
      __modalStackReset();
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
    },
  };
}

test('Escape cierra solo el modal superior, en orden inverso', async () => {
  const h = fakes();
  try {
    const closed = [];
    const a = ref(false), b = ref(false);
    useModalEscape(() => a.value, () => { closed.push('a'); a.value = false; });
    useModalEscape(() => b.value, () => { closed.push('b'); b.value = false; });
    a.value = true;
    b.value = true;
    await nextTick();
    h.keydown({ key: 'Escape' });
    assert.deepEqual(closed, ['b']);
    await nextTick();
    h.keydown({ key: 'Escape' });
    assert.deepEqual(closed, ['b', 'a']);
  } finally {
    h.restore();
  }
});

test('sin modal abierto, Escape no hace nada ni falla', () => {
  const h = fakes();
  try {
    let calls = 0;
    const a = ref(false);
    useModalEscape(() => a.value, () => { calls += 1; });
    h.keydown({ key: 'Escape' });
    h.keydown({ key: 'Enter' });
    assert.equal(calls, 0);
    assert.deepEqual(h.listeners.keydown ?? [], []);
  } finally {
    h.restore();
  }
});

test('scroll bloqueado mientras haya modal; restaura el valor original', async () => {
  const h = fakes({ overflow: 'auto' });
  try {
    const a = ref(false), b = ref(false);
    const stopA = useModalEscape(() => a.value, () => { a.value = false; });
    const stopB = useModalEscape(() => b.value, () => { b.value = false; });
    a.value = true;
    await nextTick();
    assert.equal(globalThis.document.body.style.overflow, 'hidden');
    b.value = true;
    await nextTick();
    b.value = false;
    await nextTick();
    assert.equal(globalThis.document.body.style.overflow, 'hidden');
    stopA();
    stopB();
    a.value = false;
    await nextTick();
    assert.equal(globalThis.document.body.style.overflow, 'auto');
  } finally {
    h.restore();
  }
});

test('un solo listener global y limpieza al liberar el último', async () => {
  const h = fakes();
  try {
    const a = ref(true);
    const dispose = useModalEscape(() => a.value, () => { a.value = false; });
    await nextTick();
    assert.equal((h.listeners.keydown ?? []).length, 1);
    const b = ref(true);
    useModalEscape(() => b.value, () => { b.value = false; });
    await nextTick();
    assert.equal((h.listeners.keydown ?? []).length, 1);
    dispose();
    a.value = false;
    b.value = false;
    await nextTick();
    assert.deepEqual(h.listeners.keydown ?? [], []);
  } finally {
    h.restore();
  }
});

test('con drawer abierto, Escape no cierra el modal', async () => {
  const h = fakes({ drawer: true });
  try {
    let calls = 0;
    const a = ref(true);
    useModalEscape(() => a.value, () => { calls += 1; a.value = false; });
    await nextTick();
    h.keydown({ key: 'Escape' });
    assert.equal(calls, 0);
    assert.equal(a.value, true);
  } finally {
    h.restore();
  }
});

test('las 9 vistas registran sus modales con sus cierres propios', () => {  const pairs = {
    AlarmsView: [['showDetail', 'closeDetail']],
    MaintenanceView: [['showForm', 'closeForm']],
    MaintenanceDetailView: [['pendingTransition', 'closeTransitionConfirm'], ['showEditForm', 'closeEditForm'], ['showActivityForm', 'closeActivityForm'], ['confirmingDelete', 'closeDeleteConfirm']],
    InventoryView: [['showCreate', 'closeCreate'], ['showOpCreate', 'closeOpCreate'], ['showOpDetail', 'closeOpDetail']],
    InventoryDetailView: [['showEdit', 'closeEdit'], ['showNewItem', 'closeNewItem'], ['transitionItem', 'closeTransition'], ['showQuantity', 'closeQuantity']],
    OperationsView: [['showForm', 'closeForm']],
    MaterialRequestDetailView: [['pendingTransition', 'closeTransitionConfirm'], ['showCancelConfirm', 'closeCancelConfirm'], ['serialPicker', 'closeSerialPicker'], ['showDeliverModal', 'closeDeliver']],
    UsersView: [['showForm', 'closeForm'], ['confirming', 'closeConfirm']],
    ClientsView: [['showForm', 'closeForm'], ['confirming', 'closeStatus']],
  };
  let total = 0;
  for (const [view, list] of Object.entries(pairs)) {
    const source = readFileSync(new URL(`../src/views/${view}.vue`, import.meta.url), 'utf8');
    assert.match(source, /import \{ useModalEscape \} from '\.\.\/composables\/useModalStack\.js';/);
    for (const [flag, close] of list) {
      assert.ok(source.includes(`useModalEscape(() => ${flag}.value, ${close});`), `${view}: ${flag} → ${close}`);
      total += 1;
    }
  }
  assert.equal(total, 22);
});

// UX-03C2B: foco inicial y retorno. Diálogos y controles simulados.

function fakeControl(name, { visible = true, disabled = false } = {}) {
  return {
    name, disabled, focused: 0, isConnected: true,
    getClientRects: () => (visible ? [{}] : []),
    focus() { this.focused += 1; globalThis.document.activeElement = this; },
  };
}

function fakeDialog(controls = [], { visible = true } = {}) {
  const dlg = {
    focused: 0, isConnected: true, attrs: {},
    hasAttribute(k) { return k in this.attrs; },
    setAttribute(k, v) { this.attrs[k] = v; },
    getClientRects: () => (visible ? [{}] : []),
    // Emula el :not([disabled]) del selector real (el DOM lo filtra solo).
    querySelectorAll: () => controls.filter(el => !el.disabled),
    contains(el) { return el === dlg || controls.includes(el); },
    focus() { this.focused += 1; globalThis.document.activeElement = this; },
  };
  return dlg;
}

function tabEvent(shiftKey = false) {
  return {
    key: 'Tab', shiftKey, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  };
}

function dialogFakes({ pairs = [], main = null } = {}) {
  const h = fakes();
  globalThis.document.querySelectorAll = sel => {
    if (sel !== '.modal[role="dialog"]') return [];
    return pairs
      .filter(p => p.flag.value)
      .map(p => p.dialog)
      .filter(d => d.getClientRects().length > 0);
  };
  globalThis.document.getElementById = id => (id === 'main-content' ? main : null);
  return h;
}

const twoTicks = async () => { await nextTick(); await nextTick(); };

test('foco inicial al primer control visible tras abrir', async () => {
  const trigger = fakeControl('trigger');
  const cancel = fakeControl('cancel');
  const input = fakeControl('input');
  const dlg = fakeDialog([cancel, input]);
  const open = ref(false);
  const h = dialogFakes({ pairs: [{ flag: open, dialog: dlg }] });
  try {
    globalThis.document.activeElement = trigger;
    useModalEscape(() => open.value, () => { open.value = false; });
    open.value = true;
    await twoTicks();
    assert.equal(cancel.focused, 1);
    assert.equal(input.focused, 0);
  } finally {
    h.restore();
  }
});

test('sin controles: contenedor con tabindex -1', async () => {
  const dlg = fakeDialog([]);
  const open = ref(false);
  const h = dialogFakes({ pairs: [{ flag: open, dialog: dlg }] });
  try {
    useModalEscape(() => open.value, () => { open.value = false; });
    open.value = true;
    await twoTicks();
    assert.equal(dlg.focused, 1);
    assert.equal(dlg.attrs.tabindex, '-1');
  } finally {
    h.restore();
  }
});

test('al cerrar, el foco vuelve al disparador', async () => {
  const trigger = fakeControl('trigger');
  const control = fakeControl('control');
  const dlg = fakeDialog([control]);
  const open = ref(false);
  const h = dialogFakes({ pairs: [{ flag: open, dialog: dlg }] });
  try {
    globalThis.document.activeElement = trigger;
    useModalEscape(() => open.value, () => { open.value = false; });
    open.value = true;
    await twoTicks();
    assert.equal(control.focused, 1);
    open.value = false;
    await twoTicks();
    assert.equal(trigger.focused, 1);
  } finally {
    h.restore();
  }
});

test('disparador eliminado: fallback seguro a main-content', async () => {
  const trigger = fakeControl('trigger');
  trigger.isConnected = false;
  const main = fakeControl('main');
  const dlg = fakeDialog([fakeControl('control')]);
  const open = ref(false);
  const h = dialogFakes({ pairs: [{ flag: open, dialog: dlg }], main });
  try {
    globalThis.document.activeElement = trigger;
    useModalEscape(() => open.value, () => { open.value = false; });
    open.value = true;
    await twoTicks();
    open.value = false;
    await twoTicks();
    assert.equal(trigger.focused, 0);
    assert.equal(main.focused, 1);
  } finally {
    h.restore();
  }
});

test('apilados: cerrar el superior enfoca el restante, nunca el fondo', async () => {
  const triggerB = fakeControl('triggerB');
  const controlA = fakeControl('controlA');
  const controlB = fakeControl('controlB');
  const dlgA = fakeDialog([controlA]);
  const dlgB = fakeDialog([controlB]);
  const main = fakeControl('main');
  const a = ref(false), b = ref(false);
  const h = dialogFakes({ pairs: [{ flag: a, dialog: dlgA }, { flag: b, dialog: dlgB }], main });
  try {
    useModalEscape(() => a.value, () => { a.value = false; });
    globalThis.document.activeElement = triggerB;
    useModalEscape(() => b.value, () => { b.value = false; });
    a.value = true;
    await twoTicks();
    assert.equal(controlA.focused, 1);
    b.value = true;
    await twoTicks();
    assert.equal(controlB.focused, 1);
    b.value = false;
    await twoTicks();
    assert.equal(controlA.focused, 2);
    assert.equal(triggerB.focused, 0);
    assert.equal(main.focused, 0);
  } finally {
    h.restore();
  }
});

test('cierre bloqueado por saving: sin robo de foco ni desregistro', async () => {
  const trigger = fakeControl('trigger');
  const control = fakeControl('control');
  const dlg = fakeDialog([control]);
  const open = ref(false);
  const h = dialogFakes({ pairs: [{ flag: open, dialog: dlg }] });
  try {
    globalThis.document.activeElement = trigger;
    let saving = true;
    const closeCalls = [];
    useModalEscape(() => open.value, () => {
      closeCalls.push(1);
      if (!saving) open.value = false;
    });
    open.value = true;
    await twoTicks();
    assert.equal(control.focused, 1);
    h.keydown({ key: 'Escape' });
    assert.equal(closeCalls.length, 1);
    assert.equal(open.value, true);
    assert.equal(trigger.focused, 0);
    assert.equal(control.focused, 1);
    saving = false;
    h.keydown({ key: 'Escape' });
    await twoTicks();
    assert.equal(open.value, false);
    assert.equal(trigger.focused, 1);
  } finally {
    h.restore();
  }
});

// UX-03C2C: contención Tab/Shift+Tab en el diálogo superior.

test('Tab en el último control envuelve al primero', async () => {
  const first = fakeControl('first');
  const last = fakeControl('last');
  const dlg = fakeDialog([first, last]);
  const open = ref(false);
  const h = dialogFakes({ pairs: [{ flag: open, dialog: dlg }] });
  try {
    useModalEscape(() => open.value, () => { open.value = false; });
    open.value = true;
    await twoTicks();
    globalThis.document.activeElement = last;
    const ev = tabEvent(false);
    h.keydown(ev);
    assert.equal(ev.defaultPrevented, true);
    assert.equal(first.focused, 2);
  } finally {
    h.restore();
  }
});

test('Shift+Tab en el primer control envuelve al último', async () => {
  const first = fakeControl('first');
  const last = fakeControl('last');
  const dlg = fakeDialog([first, last]);
  const open = ref(false);
  const h = dialogFakes({ pairs: [{ flag: open, dialog: dlg }] });
  try {
    useModalEscape(() => open.value, () => { open.value = false; });
    open.value = true;
    await twoTicks();
    globalThis.document.activeElement = first;
    const ev = tabEvent(true);
    h.keydown(ev);
    assert.equal(ev.defaultPrevented, true);
    assert.equal(last.focused, 1);
  } finally {
    h.restore();
  }
});

test('Tab intermedio no se intercepta', async () => {
  const first = fakeControl('first');
  const mid = fakeControl('mid');
  const last = fakeControl('last');
  const dlg = fakeDialog([first, mid, last]);
  const open = ref(false);
  const h = dialogFakes({ pairs: [{ flag: open, dialog: dlg }] });
  try {
    useModalEscape(() => open.value, () => { open.value = false; });
    open.value = true;
    await twoTicks();
    globalThis.document.activeElement = mid;
    const ev = tabEvent(false);
    h.keydown(ev);
    assert.equal(ev.defaultPrevented, false);
    assert.equal(first.focused, 1);
    assert.equal(last.focused, 0);
  } finally {
    h.restore();
  }
});

test('foco externo se redirige según dirección', async () => {
  const first = fakeControl('first');
  const last = fakeControl('last');
  const outside = fakeControl('outside');
  const dlg = fakeDialog([first, last]);
  const open = ref(false);
  const h = dialogFakes({ pairs: [{ flag: open, dialog: dlg }] });
  try {
    useModalEscape(() => open.value, () => { open.value = false; });
    open.value = true;
    await twoTicks();
    globalThis.document.activeElement = outside;
    const fwd = tabEvent(false);
    h.keydown(fwd);
    assert.equal(fwd.defaultPrevented, true);
    assert.equal(first.focused, 2);
    globalThis.document.activeElement = outside;
    const back = tabEvent(true);
    h.keydown(back);
    assert.equal(back.defaultPrevented, true);
    assert.equal(last.focused, 1);
  } finally {
    h.restore();
  }
});

test('controles ocultos, deshabilitados y hidden se excluyen del ciclo', async () => {
  const first = fakeControl('first');
  const hidden = fakeControl('hidden', { visible: false });
  const disabled = fakeControl('disabled', { disabled: true });
  const dlg = fakeDialog([first, hidden, disabled]);
  const open = ref(false);
  const h = dialogFakes({ pairs: [{ flag: open, dialog: dlg }] });
  try {
    useModalEscape(() => open.value, () => { open.value = false; });
    open.value = true;
    await twoTicks();
    // Solo 'first' es enfocable: Tab y Shift+Tab envuelven sobre sí mismo.
    globalThis.document.activeElement = first;
    h.keydown(tabEvent(false));
    h.keydown(tabEvent(true));
    assert.equal(first.focused, 3);
    assert.equal(hidden.focused, 0);
    assert.equal(disabled.focused, 0);
  } finally {
    h.restore();
  }
});

test('diálogo vacío retiene el foco en el contenedor', async () => {
  const dlg = fakeDialog([]);
  const open = ref(false);
  const h = dialogFakes({ pairs: [{ flag: open, dialog: dlg }] });
  try {
    useModalEscape(() => open.value, () => { open.value = false; });
    open.value = true;
    await twoTicks();
    assert.equal(dlg.focused, 1);
    globalThis.document.activeElement = fakeControl('outside');
    const ev = tabEvent(false);
    h.keydown(ev);
    assert.equal(ev.defaultPrevented, true);
    assert.equal(dlg.focused, 2);
  } finally {
    h.restore();
  }
});

test('sin modal, Tab no se intercepta; con drawer, tampoco', async () => {
  const h = fakes();
  try {
    const ev = tabEvent(false);
    h.keydown(ev);
    assert.equal(ev.defaultPrevented, false);
  } finally {
    h.restore();
  }
  const d = fakes({ drawer: true });
  try {
    const open = ref(true);
    useModalEscape(() => open.value, () => { open.value = false; });
    await nextTick();
    const ev = tabEvent(false);
    d.keydown(ev);
    assert.equal(ev.defaultPrevented, false);
  } finally {
    d.restore();
  }
});
