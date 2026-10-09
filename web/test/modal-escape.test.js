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
    querySelector: sel => (drawer && sel === '.app-shell.nav-open' ? {} : null),
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

test('las 9 vistas registran sus modales con sus cierres propios', () => {
  const pairs = {
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
