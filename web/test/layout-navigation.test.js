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
    ref, computed, watch, nextTick, onMounted() {}, onUnmounted() {},
    useRouter: () => ({ replace: async path => { replaced.push(path); } }),
    useRoute: () => route,
    supabase: null,
    getMyProfile: async () => ({ profile: { role, display_name: 'Ana', module_permissions: [] } }),
    invalidatePlantsCatalog: () => {},
    useModalEscape: () => () => {},
    useTheme: () => ({ preference: ref('light'), setThemePreference: () => true }),
    ThemeSwitch: 'ThemeSwitch',
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
    assert.match(source, /:class="\{ 'sidebar-collapsed': sidebarCollapsed, 'nav-open': mobileNavOpen \}"/);
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

test('selector de tema único: topbar en vistas, encabezado en Dashboard', () => {
  assert.doesNotMatch(source, /class="theme-switch"/);
  const sidebar = source.slice(source.indexOf('<div class="sidebar-account">'), source.indexOf('</aside>'));
  assert.doesNotMatch(sidebar, /ThemeSwitch/);
  assert.match(sidebar, /class="logout-button"/);
  const topbar = source.slice(source.indexOf('<header class="app-topbar"'), source.indexOf('</header>'));
  assert.match(topbar, /<ThemeSwitch \/>/);
  assert.match(topbar, /topbar-right/);
  const dashboard = readFileSync(new URL('../src/views/DashboardView.vue', import.meta.url), 'utf8');
  const meta = dashboard.slice(dashboard.indexOf('<div class="header-meta">'));
  assert.match(meta, /<ThemeSwitch \/>/);
  const component = readFileSync(new URL('../src/components/ThemeSwitch.vue', import.meta.url), 'utf8');
  assert.match(component, /role="menu" aria-label="Tema visual"/);
  assert.match(component, /:aria-checked="String\(themePreference === option\.value\)"/);
  assert.match(component, /:aria-label="`Tema \$\{activeTheme\.label\.toLowerCase\(\)\}\. Cambiar tema visual`"/);
  assert.match(component, /class="theme-icon"/);
  assert.match(component, /aria-haspopup="menu"/);
  assert.match(component, /value: 'light'.*value: 'dark'.*value: 'auto'/s);
  const styles = descriptor.styles.map(block => block.content).join('\n').replace(/\r\n/g, '\n');
  assert.match(styles, /\.topbar-right \{\n  display: flex;/);
  const componentStyles = component.slice(component.indexOf('<style'));
  assert.match(componentStyles, /\.theme-switch \{\n  display: inline-flex;/);
  assert.match(componentStyles, /\.theme-trigger \{[^}]*width: 36px;[^}]*height: 36px;/);
  assert.match(componentStyles, /\.theme-option\[aria-checked='true'\] \{\n  background: var\(--rdx-neutral-soft\);/);
});

test('UX-02B: drawer móvil abre/cierra con Escape y al navegar', async () => {
  const { view, route, restore } = setup();
  try {
    assert.equal(view.isMobile.value, false);
    assert.equal(view.mobileNavOpen.value, false);
    view.openMobileNav();
    assert.equal(view.mobileNavOpen.value, true);
    view.onGlobalKeydown({ key: 'Enter' });
    assert.equal(view.mobileNavOpen.value, true);
    view.onGlobalKeydown({ key: 'Escape' });
    assert.equal(view.mobileNavOpen.value, false);
    view.openMobileNav();
    route.name = 'plants';
    await nextTick();
    assert.equal(view.mobileNavOpen.value, false);
    view.onMenuButtonClick();
    assert.equal(view.sidebarCollapsed.value, true);
  } finally {
    restore();
  }
});

test('UX-02B: cableado drawer, topbar móvil en Dashboard y sin overflow', () => {
  assert.match(source, /<aside ref="sidebarRef" class="sidebar" id="primary-sidebar" tabindex="-1"/);
  assert.match(source, /aria-controls="primary-sidebar"/);
  assert.match(source, /:aria-expanded="String\(isMobile \? mobileNavOpen : !sidebarCollapsed\)"/);
  assert.match(source, /@click="onMenuButtonClick"/);
  assert.match(source, /<div v-if="mobileNavOpen" class="nav-backdrop" aria-hidden="true"/);
  assert.match(source, /class="drawer-close"[^>]*aria-label="Cerrar menú de navegación"/);
  assert.match(source, /if \(event\?\.key === 'Escape' && mobileNavOpen\.value\) closeMobileNav\(\)/);
  assert.match(source, /window\.matchMedia\(MOBILE_QUERY\)/);
  assert.match(source, /document\.body\.style\.overflow = 'hidden'/);
  assert.match(source, /if \(mobileNavOpen\.value\) closeMobileNav\(false\)/);
  const layoutStyles = descriptor.styles.map(block => block.content).join('\n').replace(/\r\n/g, '\n');
  assert.match(layoutStyles, /\.app-shell\.nav-open \.sidebar \{\n    visibility: visible;/);
  assert.match(layoutStyles, /transform: translateX\(-105%\)/);
  assert.match(layoutStyles, /z-index: 60;/);
  assert.match(layoutStyles, /z-index: 55;/);
  assert.match(layoutStyles, /\.drawer-close \{\n  display: none;/);
  const globalCss = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(globalCss, /\.app-shell \{ grid-template-columns: 1fr; align-items: stretch; overflow-x: clip; \}/);
  const dashboard = readFileSync(new URL('../src/views/DashboardView.vue', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(dashboard, /@media \(min-width: 721px\) \{/);
  assert.match(dashboard, /:global\(\.app-shell:has\(\.dashboard-view\) \.app-topbar\) \{ display: none; \}/);
  assert.match(dashboard, /@media \(max-width: 720px\) \{/);
  assert.match(dashboard, /\.header-meta \.theme-switch \{ display: none; \}/);
  assert.match(layoutStyles, /\.crumb-section,\n {2}\.crumb-separator \{\n    display: none;/);
});

test('UX-02A: sidebar con nav desplazable y mapa bajo la topbar', () => {
  const styles = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(styles, /\.sidebar nav \{[^}]*overflow-y: auto;[^}]*overflow-x: hidden;/);
  assert.match(styles, /\.sidebar \{[^}]*overflow-x: hidden;/);
  const map = readFileSync(new URL('../src/views/PlantMapView.vue', import.meta.url), 'utf8');
  assert.match(map, /\.map-stage \{ position: relative; z-index: 0; min-width: 0; \}/);
  assert.match(map, /\.map-header > div > p \{/);
  const plants = readFileSync(new URL('../src/views/PlantsView.vue', import.meta.url), 'utf8');
  assert.match(plants, /\.plants-header > div > p \{/);
});

test('Inventory sticky queda debajo de la topbar con variable compartida', () => {
  const inventory = readFileSync(new URL('../src/views/InventoryView.vue', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(styles, /--rdx-topbar-height:\s*4[4-8]px/);
  assert.match(source, /position: sticky/);
  assert.match(source, /top: 0/);
  assert.match(inventory, /top: var\(--rdx-topbar-height/);
});
