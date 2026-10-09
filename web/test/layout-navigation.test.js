import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { computed, nextTick, reactive, ref, watch } from 'vue';

const source = readFileSync(new URL('../src/layouts/AppLayout.vue', import.meta.url), 'utf8');
const { descriptor } = parse(source);
const code = compileScript(descriptor, { id: 'layout-navigation-test' }).content
  .replace(/^import[^;]*;$/gm, '').replace('export default', 'return');

function memoryStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: key => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    _store: store,
  };
}

function setup({ routeName = 'dashboard', storage = null, role = 'rdx_admin' } = {}) {
  const previous = globalThis.localStorage;
  globalThis.localStorage = storage ?? undefined;
  const route = reactive({ name: routeName });
  const replaced = [];
  const deps = {
    ref, computed, watch, onMounted() {},
    useRouter: () => ({ replace: async path => { replaced.push(path); } }),
    useRoute: () => route,
    supabase: null,
    getMyProfile: async () => ({ profile: { role, display_name: 'Ana', module_permissions: [] } }),
    invalidatePlantsCatalog: () => {},
    useTheme: () => ({ preference: ref('light'), setThemePreference: () => true }),
  };
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps));
  const view = component.setup({}, { expose() {} });
  return {
    view, route, replaced,
    restore: () => { globalThis.localStorage = previous; },
  };
}

test('estructura de las 3 secciones se conserva con el orden indicado', () => {
  const nav = source.slice(source.indexOf('<nav'), source.indexOf('</nav>'));
  const headings = [...nav.matchAll(/<span>(Monitoreo|Operaciones|Administración)<\/span>/g)].map(match => match[1]);
  assert.deepEqual(headings, ['Monitoreo', 'Operaciones', 'Administración']);
  const labels = [...nav.matchAll(/<span>(Dashboard|Plantas|Mapa|Dispositivos|Alarmas|Mantenimiento|Inventario|Solicitudes de materiales|Usuarios|Clientes)<\/span>/g)]
    .map(match => match[1]);
  assert.deepEqual(labels, [
    'Dashboard', 'Plantas', 'Mapa', 'Dispositivos', 'Alarmas',
    'Mantenimiento', 'Inventario', 'Solicitudes de materiales',
    'Usuarios', 'Clientes',
  ]);
  assert.match(source, /canSee\('operations'\)[^>]*to="\/operations"/);
});

test('sidebar puede contraerse y expandirse', () => {
  const { view, restore } = setup();
  try {
    assert.equal(view.sidebarCollapsed.value, false);
    view.toggleSidebar();
    assert.equal(view.sidebarCollapsed.value, true);
    view.toggleSidebar();
    assert.equal(view.sidebarCollapsed.value, false);
    assert.match(source, /:class="\{ 'sidebar-collapsed': sidebarCollapsed \}"/);
    assert.match(source, /:class="\{ collapsed: sidebarCollapsed \}"/);
  } finally {
    restore();
  }
});

test('estado del sidebar se persiste y se recupera al recargar', () => {
  const storage = memoryStorage();
  const first = setup({ storage });
  try {
    first.view.toggleSidebar();
    assert.equal(storage._store['rdx.sidebar.collapsed'], 'true');
  } finally {
    first.restore();
  }
  const second = setup({ storage });
  try {
    assert.equal(second.view.sidebarCollapsed.value, true);
  } finally {
    second.restore();
  }
});

test('secciones pueden abrirse y cerrarse sin tocar permisos', () => {
  const { view, restore } = setup();
  try {
    assert.deepEqual({ ...view.openSections.value }, { monitoreo: true, operaciones: true, administracion: true });
    view.toggleSection('operaciones');
    assert.equal(view.openSections.value.operaciones, false);
    assert.equal(view.openSections.value.monitoreo, true);
    view.toggleSection('operaciones');
    assert.equal(view.openSections.value.operaciones, true);
    assert.match(source, /v-show="openSections\.monitoreo"/);
    assert.match(source, /v-show="openSections\.operaciones"/);
    assert.match(source, /v-show="openSections\.administracion"/);
  } finally {
    restore();
  }
});

test('estados de secciones se persisten y se recuperan', () => {
  const storage = memoryStorage();
  const first = setup({ routeName: 'login', storage });
  try {
    first.view.toggleSection('monitoreo');
    const saved = JSON.parse(storage._store['rdx.sidebar.sections']);
    assert.equal(saved.monitoreo, false);
    assert.equal(saved.operaciones, true);
  } finally {
    first.restore();
  }
  const second = setup({ routeName: 'login', storage });
  try {
    assert.equal(second.view.openSections.value.monitoreo, false);
    assert.equal(second.view.openSections.value.operaciones, true);
  } finally {
    second.restore();
  }
});

test('sección de la ruta activa se abre automáticamente', async () => {
  const storage = memoryStorage({
    'rdx.sidebar.sections': JSON.stringify({ monitoreo: false, operaciones: false, administracion: false }),
  });
  const { view, route, restore } = setup({ routeName: 'inventory', storage });
  try {
    assert.equal(view.openSections.value.operaciones, true);
    assert.equal(view.openSections.value.monitoreo, false);
    view.toggleSection('operaciones');
    assert.equal(view.openSections.value.operaciones, false);
    route.name = 'operations';
    await nextTick();
    assert.equal(view.openSections.value.operaciones, true);
  } finally {
    restore();
  }
});

test('breadcrumb corresponde a la ruta sin hardcodear solo Inventory', () => {
  const cases = [
    ['inventory', { section: 'Operaciones', label: 'Inventario' }],
    ['operations', { section: 'Operaciones', label: 'Solicitudes de materiales' }],
    ['maintenance', { section: 'Operaciones', label: 'Mantenimiento' }],
    ['dashboard', { section: 'Monitoreo', label: 'Dashboard' }],
    ['plants', { section: 'Monitoreo', label: 'Plantas' }],
    ['clients', { section: 'Administración', label: 'Clientes' }],
    ['users', { section: 'Administración', label: 'Usuarios' }],
  ];
  for (const [routeName, expected] of cases) {
    const { view, restore } = setup({ routeName });
    try {
      assert.deepEqual({ ...view.breadcrumb.value }, expected);
    } finally {
      restore();
    }
  }
});

test('usuario no se duplica en topbar y se conserva en el sidebar', () => {
  const topbar = source.slice(source.indexOf('<header class="app-topbar"'), source.indexOf('</header>'));
  assert.doesNotMatch(topbar, /displayName/);
  assert.doesNotMatch(topbar, /account-avatar/);
  assert.match(topbar, /Nexora/);
  assert.match(source, /class="account-name">\{\{ displayName \}\}/);
});

test('sin funcionalidad de notificaciones no se muestra icono', () => {
  const topbar = source.slice(source.indexOf('<header class="app-topbar"'), source.indexOf('</header>'));
  assert.doesNotMatch(topbar, /🔔/i);
  assert.doesNotMatch(topbar, /bell/i);
  assert.doesNotMatch(topbar, /notif/i);
});

test('Solicitudes de materiales conserva key operations y permisos', () => {
  const router = readFileSync(new URL('../src/router/index.js', import.meta.url), 'utf8');
  assert.match(router, /path: '\/operations',/);
  assert.match(router, /name: 'operations',/);
  assert.match(router, /operations: 'operations',/);
  assert.match(source, /canSee\('operations'\)/);
  assert.match(source, /to="\/operations"/);
  assert.doesNotMatch(source, /canSee\('material-requests'\)/);
});

test('selector de tema único en sidebar, fuera del topbar', () => {
  const topbar = source.slice(source.indexOf('<header class="app-topbar"'), source.indexOf('</header>'));
  assert.doesNotMatch(topbar, /theme-switch/);
  const occurrences = source.match(/class="theme-switch"/g) ?? [];
  assert.equal(occurrences.length, 1);
  const sidebar = source.slice(source.indexOf('<div class="sidebar-account">'));
  const switchIndex = source.indexOf('class="theme-switch"');
  assert.ok(switchIndex > source.indexOf('<div class="sidebar-account">'));
  assert.ok(switchIndex < source.indexOf('class="logout-button"'));
  assert.ok(switchIndex > sidebar.indexOf('account-client') + source.indexOf('<div class="sidebar-account">'));
  assert.match(source, /role="group" aria-label="Tema visual"/);
  assert.match(source, /:aria-pressed="String\(themePreference === option\.value\)"/);
});

test('Inventory sticky queda debajo de la topbar con variable compartida', () => {
  const inventory = readFileSync(new URL('../src/views/InventoryView.vue', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(styles, /--rdx-topbar-height:\s*4[4-8]px/);
  assert.match(source, /position: sticky/);
  assert.match(source, /top: 0/);
  assert.match(inventory, /top: var\(--rdx-topbar-height/);
});
