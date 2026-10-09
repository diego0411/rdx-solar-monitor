import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// UX-01C: contrato estático de adaptación a temas (sin DOM ni red).
// ECharts re-renderiza por evento, Leaflet usa tiles duales y los colores
// fijos restantes usan tokens. Cálculos y datos intactos.

const curve = readFileSync(new URL('../src/components/PlantPowerCurve.vue', import.meta.url), 'utf8');
const history = readFileSync(new URL('../src/components/PlantEnergyHistory.vue', import.meta.url), 'utf8');
const map = readFileSync(new URL('../src/views/PlantMapView.vue', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

test('1: charts se suscriben a rdx:theme, re-renderizan y limpian', () => {
  for (const [name, source] of [['PowerCurve', curve], ['EnergyHistory', history]]) {
    assert.match(source, /addEventListener\('rdx:theme', renderOnThemeChange\)/, `${name} suscribe`);
    assert.match(source, /removeEventListener\('rdx:theme', renderOnThemeChange\)/, `${name} limpia`);
    assert.match(source, /function renderOnThemeChange\(\) \{ render\(\); \}/, `${name} solo re-renderiza`);
  }
  assert.ok(!/renderOnThemeChange[^}]*apiFetch/s.test(curve), 'sin refetch en PowerCurve');
  assert.ok(!/renderOnThemeChange[^}]*apiFetch/s.test(history), 'sin refetch en EnergyHistory');
});

test('2: series y significado intactos; colores por token en cada render', () => {
  for (const source of [curve, history]) {
    assert.match(source, /textStyle: \{ color: rdxColor\('--rdx-text'\)/);
    assert.match(source, /axisLabel: \{ color: rdxColor\('--rdx-text-muted'\)/);
  }
  assert.match(history, /color: \[rdxColor\('--rdx-primary'\), \.\.\.CHART_SERIES_COLORS\]/);
  assert.match(curve, /color: \[rdxColor\('--rdx-chart-green'\), rdxColor\('--rdx-chart-amber'\), rdxColor\('--rdx-chart-blue'\), rdxColor\('--rdx-chart-purple'\)\]/);
  assert.match(curve, /\['generation_power_w', 'Generación'\]/);
  assert.match(history, /\['generation_kwh', 'Generación'\]/);
});

test('3: mapa usa OSM en ambos temas, sin proveedores oscuros', () => {
  assert.match(map, /OSM_TILE_URL = 'https:\/\/tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png'/);
  assert.ok(!map.includes('cartocdn'), 'sin CARTO (requiere API key)');
  assert.ok(!map.includes('arcgisonline'), 'sin Esri (sin cobertura)');
  assert.ok(!map.includes('MAP_TILES'), 'sin selección por tema');
  assert.match(map, /if \(!map \|\| tileLayer\) return;/);
  assert.match(map, /renderMarkers\(\{ fit: false \}\)/);
  assert.match(map, /tileLayer = null;/);
  assert.match(map, /renderMarkers\(\{ fit: false \}\)/);
  assert.match(map, /addEventListener\('rdx:theme', refreshMapTheme\)/);
  assert.match(map, /removeEventListener\('rdx:theme', refreshMapTheme\)/);
  assert.match(map, /fillColor: markerColor\(plant\.status\)/);
  assert.ok(!map.includes('badgeStyles') && !map.includes('freshnessStyles') && !map.includes('markerColors'), 'sin estilos cacheados');
});

test('4: paleta oscura redefine todos los tokens de color del claro', () => {
  const root = css.slice(css.indexOf(':root'), css.indexOf('[data-theme'));
  const dark = css.slice(css.indexOf("[data-theme='dark']"));
  const lightTokens = [...root.matchAll(/--([\w-]+):\s*(#[0-9a-f]{3,6}|rgba?\([^;]+\));/gi)].map(m => m[1])
    .filter(name => !/^(rdx-radius|rdx-space|rdx-transition|rdx-topbar)/.test(name));
  const missing = lightTokens.filter(name => !new RegExp(`--${name}:`).test(dark));
  assert.deepEqual(missing, []);
});

test('6: fix B1, controles y popups Leaflet legibles solo en oscuro', () => {
  const dark = css.slice(css.indexOf("[data-theme='dark']"));
  assert.match(dark, /\[data-theme='dark'\] \.leaflet-popup-content-wrapper,\n\[data-theme='dark'\] \.leaflet-popup-tip \{\n  background: var\(--rdx-surface\);\n  color: var\(--rdx-text\);\n\}/);
  assert.match(dark, /\[data-theme='dark'\] \.leaflet-bar a \{\n  background-color: var\(--rdx-surface\);\n  border-color: var\(--rdx-border\);\n  color: var\(--rdx-text-strong\);\n\}/);
  assert.match(dark, /\[data-theme='dark'\] \.leaflet-bar a:hover,\n\[data-theme='dark'\] \.leaflet-bar a:focus \{\n  background-color: var\(--rdx-surface-raised\);\n\}/);
  assert.match(dark, /\[data-theme='dark'\] \.leaflet-control-attribution \{[^}]*color: var\(--rdx-text-muted\);\n\}/);
  const light = css.slice(0, css.indexOf("[data-theme='dark']"));
  assert.ok(!light.includes('.leaflet-'), 'claro sin overrides Leaflet');
});

test('7: botones CTA usan tokens on-* con contraste AA en ambos temas', () => {
  assert.match(css, /--rdx-on-danger: #ffffff;/);
  const dark = css.slice(css.indexOf("[data-theme='dark']"));
  assert.match(dark, /--rdx-on-danger: #10231a;/);
  const maintenance = readFileSync(new URL('../src/views/MaintenanceDetailView.vue', import.meta.url), 'utf8');
  assert.match(maintenance, /\.danger-button \{\n  background: var\(--rdx-danger\);\n  color: var\(--rdx-on-danger\);\n\}/);
  assert.match(maintenance, /\.primary-button \{\n  padding: 10px 16px;\n  border: 0;\n  border-radius: 8px;\n  background: var\(--rdx-primary\);\n  color: var\(--rdx-on-primary\);/);
  assert.ok(!maintenance.includes('color: white'), 'MaintenanceDetail sin blanco fijo');
  const plants = readFileSync(new URL('../src/views/PlantsView.vue', import.meta.url), 'utf8');
  assert.ok(!plants.includes('color: white'), 'Plants sin blanco fijo');
});

test('8: foco visible en filtros de Dispositivos y filas seleccionables', () => {
  const devices = readFileSync(new URL('../src/views/DevicesView.vue', import.meta.url), 'utf8');
  assert.match(devices, /\.filters input:focus-visible,\.filters select:focus-visible\{outline:2px solid var\(--rdx-focus\);/);
  assert.ok(!devices.includes('outline:2px solid var(--rdx-focus-soft)'), 'sin anillo tenue');
  assert.ok(!devices.includes('tbody tr:focus,'), 'sin :focus que anule el anillo de teclado');
  assert.ok(devices.includes('tbody tr:focus:not(:focus-visible)'), 'ratón sin anillo, teclado con anillo global');
  assert.match(css, /tbody tr\[tabindex\]:focus-visible \{\n  outline: 2px solid var\(--rdx-focus\);\n  outline-offset: -2px;\n\}/);
});

test('9: panel de detalle en Devices queda debajo de la topbar', () => {
  const devices = readFileSync(new URL('../src/views/DevicesView.vue', import.meta.url), 'utf8');
  assert.match(devices, /\.detail\{position:sticky;top:calc\(var\(--rdx-topbar-height, 46px\) \+ 24px\)\}/);
  assert.ok(!devices.includes('.detail{position:sticky;top:18px}'), 'sin offset bajo la topbar');
  assert.match(devices, /\.detail\{position:fixed;z-index:40;left:14px;right:14px;bottom:14px;/);
});

test('10: sheet de Devices bajo drawer y acciones con wrap en móvil', () => {
  const devices = readFileSync(new URL('../src/views/DevicesView.vue', import.meta.url), 'utf8');
  assert.match(devices, /\.detail\{position:fixed;z-index:40;left:14px;right:14px;bottom:14px;/);
  assert.ok(!devices.includes('z-index:1200'), 'sheet sin capa sobre el drawer');
  const layout = readFileSync(new URL('../src/layouts/AppLayout.vue', import.meta.url), 'utf8');
  assert.match(layout, /z-index: 60;/);
  assert.match(layout, /z-index: 55;/);
  const inventory = readFileSync(new URL('../src/views/InventoryView.vue', import.meta.url), 'utf8');
  assert.match(inventory, /\.header-actions \{ flex-wrap: wrap; \}/);
});

test('11: h1 y márgenes de encabezados en rango coherente', () => {
  const devices = readFileSync(new URL('../src/views/DevicesView.vue', import.meta.url), 'utf8');
  assert.match(devices, /@media\(max-width:720px\)\{\.devices-header h1\{font-size:28px\}\}/);
  assert.match(devices, /\.devices-header\{justify-content:space-between;gap:24px;margin-bottom:22px\}/);
  for (const [file, cls] of [['AlarmsView', 'alarms-header'], ['MaintenanceView', 'maintenance-header'], ['OperationsView', 'operations-header']]) {
    const source = readFileSync(new URL(`../src/views/${file}.vue`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    assert.match(source, new RegExp(`\\.${cls} \\{\\n  display: flex;\\n  justify-content: space-between;\\n  align-items: flex-start;\\n  gap: 24px;\\n  margin-bottom: 22px;\\n\\}`));
  }
  const map = readFileSync(new URL('../src/views/PlantMapView.vue', import.meta.url), 'utf8');
  assert.match(map, /\.map-header \{ display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; margin: 0 4px 20px; \}/);
});

test('12: metadatos mínimos 10px y muted en textos pequeños', () => {
  const devices = readFileSync(new URL('../src/views/DevicesView.vue', import.meta.url), 'utf8');
  assert.ok(!devices.includes('font-size:8px'), 'Devices sin 8px');
  assert.ok(!devices.includes('font-size:9px'), 'Devices sin 9px');
  assert.ok(!devices.includes('var(--rdx-text-faint)'), 'Devices sin faint');
  assert.ok(!devices.includes('var(--rdx-devices-subtle-text)'), 'Devices sin subtle en texto');
  assert.match(devices, /\.device small,.date\{display:block;color:var\(--rdx-text-muted\);font-size:10px;line-height:1.4\}/);
  const plants = readFileSync(new URL('../src/views/PlantsView.vue', import.meta.url), 'utf8');
  assert.ok(!plants.includes('var(--rdx-text-faint)'), 'Plants sin faint');
  const inventory = readFileSync(new URL('../src/views/InventoryView.vue', import.meta.url), 'utf8');
  assert.ok(!inventory.includes('var(--rdx-text-faint)'), 'Inventory sin faint');
  const inventoryDetail = readFileSync(new URL('../src/views/InventoryDetailView.vue', import.meta.url), 'utf8');
  assert.ok(!inventoryDetail.includes('var(--rdx-text-faint)'), 'InventoryDetail sin faint');
  const alarms = readFileSync(new URL('../src/views/AlarmsView.vue', import.meta.url), 'utf8');
  assert.ok(!alarms.includes('var(--rdx-text-faint'), 'Alarms sin faint');
});

test('13: etiquetas técnicas pequeñas en 10-11px', () => {
  const plants = readFileSync(new URL('../src/views/PlantsView.vue', import.meta.url), 'utf8');
  assert.ok(!plants.includes('font-size: 9px'), 'Plants sin 9px');
  assert.match(plants, /\.plant-metrics dt \{ color: var\(--rdx-text-muted\); font-size: 11px;/);
  assert.match(plants, /\.foot-metric > span:not\(\.foot-icon\) \{ color: var\(--rdx-text-muted\); font-size: 11px;/);
  const detail = readFileSync(new URL('../src/views/PlantDetailView.vue', import.meta.url), 'utf8');
  assert.match(detail, /\.perf-head > span \{ color: var\(--rdx-text-muted\); font-size: 11px; \}/);
  assert.match(detail, /\.device-meta dt \{ font-size: 11px; \}/);
  const economics = readFileSync(new URL('../src/components/PlantEconomics.vue', import.meta.url), 'utf8');
  assert.match(economics, /\.form-grid label \{ display: grid; gap: 5px; color: var\(--rdx-text-muted\); font-size: 11px;/);
  assert.match(economics, /\.metric-coverage \{ display: block; margin-top: 2px; color: var\(--rdx-warning\); font-size: 11px;/);
});

test('5: textos sobre fondos de marca con contraste en ambos temas', () => {
  assert.match(css, /--rdx-on-primary: #ffffff;/);
  assert.match(css, /--rdx-on-accent: #ffffff;/);
  assert.match(css, /--rdx-primary-text: #174d3c;/);
  const dark = css.slice(css.indexOf("[data-theme='dark']"));
  assert.match(dark, /--rdx-on-primary: #ffffff;/);
  assert.match(dark, /--rdx-on-accent: #10231a;/);
  assert.match(dark, /--rdx-primary-text: #8fceaa;/);
  for (const file of ['ClientsView', 'InventoryView', 'InventoryDetailView']) {
    const source = readFileSync(new URL(`../src/views/${file}.vue`, import.meta.url), 'utf8');
    assert.ok(!source.includes('color: #fff'), `${file} sin #fff fijo`);
  }
  for (const file of ['MaintenanceView', 'OperationsView', 'MaterialRequestDetailView']) {
    const source = readFileSync(new URL(`../src/views/${file}.vue`, import.meta.url), 'utf8');
    assert.ok(!source.includes('color: #fff'), `${file} sin #fff fijo`);
  }
});
