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
    assert.match(source, /color: \[rdxColor\('--rdx-primary'\), \.\.\.CHART_SERIES_COLORS\]/);
    assert.match(source, /textStyle: \{ color: rdxColor\('--rdx-text'\)/);
    assert.match(source, /axisLabel: \{ color: rdxColor\('--rdx-text-muted'\)/);
  }
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
