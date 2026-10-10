import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// UX-05E1: contrato estático de contraste AA para C1–C9 (sin DOM ni red).
// Verifica los valores CSS efectivos (tokens por tema + fondos reales de
// cada componente) y que los cambios no toquen ECharts, Leaflet ni faint.
// Relación antes → después documentada en BEFORE/AFTER.

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const plants = readFileSync(new URL('../src/views/PlantsView.vue', import.meta.url), 'utf8');
const clients = readFileSync(new URL('../src/views/ClientsView.vue', import.meta.url), 'utf8');
const inventoryDetail = readFileSync(new URL('../src/views/InventoryDetailView.vue', import.meta.url), 'utf8');
const flow = readFileSync(new URL('../src/components/PlantEnergyFlow.vue', import.meta.url), 'utf8');
const deviceDetail = readFileSync(new URL('../src/views/DeviceDetailView.vue', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/views/DashboardView.vue', import.meta.url), 'utf8');

// Antes (auditoría UX-05E) → después (UX-05E1). Solo tokens claros de
// semáforo/proveedor/alarma + overrides oscuros acotados.
const AFTER = {
  light: {
    '--rdx-success': '#20693d', // antes #2b8a53
    '--rdx-warning': '#8a5a0b', // antes #b57417
    '--rdx-danger': '#a63a2c', // antes #c25238
    '--rdx-provider-hyxi': '#0e6f9e', // antes #148ac1
    '--rdx-provider-growatt': '#4a760e', // antes #62a818
    '--rdx-devices-row-alarm': '#7d5207', // antes #b97508
  },
};

function tokensOf(block) {
  const map = new Map();
  for (const m of block.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\b/g)) map.set(`--${m[1]}`, m[2].toLowerCase());
  return map;
}
const rootBlock = css.slice(css.indexOf(':root'), css.indexOf("[data-theme='dark'] {"));
const darkBlock = css.slice(css.indexOf("[data-theme='dark'] {"), css.indexOf("[data-theme='dark'] .card.modal"));
const light = tokensOf(rootBlock);
const dark = new Map([...light, ...tokensOf(darkBlock)]);

function rgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map(c => c + c).join('');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
}
function lum(hex) {
  const [r, g, b] = rgb(hex).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(fg, bg) {
  const a = lum(fg); const b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
const atLeast = (fg, bg, min, label) => {
  const value = ratio(fg, bg);
  assert.ok(value >= min, `${label}: ${value.toFixed(2)}:1 < ${min}:1 (${fg} sobre ${bg})`);
};

test('1: tokens claros corregidos tienen los valores esperados', () => {
  for (const [name, hex] of Object.entries(AFTER.light)) assert.equal(light.get(name), hex, name);
});

test('2: C4+C5 claro — semáforo sobre fondos soft ≥4.5:1', () => {
  atLeast(light.get('--rdx-danger'), light.get('--rdx-danger-soft'), 4.5, 'danger/danger-soft');
  atLeast(light.get('--rdx-success'), light.get('--rdx-success-soft'), 4.5, 'success/success-soft');
  atLeast(light.get('--rdx-warning'), light.get('--rdx-warning-soft'), 4.5, 'warning/warning-soft');
  atLeast(light.get('--rdx-danger'), '#ffffff', 4.5, 'danger/surface (login-error, form-error)');
  atLeast('#ffffff', light.get('--rdx-danger'), 4.5, 'blanco sobre danger (CTA MaintenanceDetail)');
});

test('3: C6 claro — proveedor sobre fondo real ≥4.5:1', () => {
  for (const bg of ['#ffffff', light.get('--rdx-background')]) {
    atLeast(light.get('--rdx-provider-hyxi'), bg, 4.5, `hyxi/${bg}`);
    atLeast(light.get('--rdx-provider-growatt'), bg, 4.5, `growatt/${bg}`);
  }
});

test('4: C8 claro — alarma de dispositivos sobre superficie ≥4.5:1', () => {
  atLeast(light.get('--rdx-devices-row-alarm'), light.get('--rdx-surface'), 4.5, 'row-alarm/surface');
});

test('5: C1+C2+C3+C9 oscuro — overrides acotados ≥4.5:1', () => {
  atLeast(dark.get('--rdx-danger'), dark.get('--rdx-sidebar'), 4.5, 'C1 danger/sidebar');
  atLeast(dark.get('--rdx-accent'), dark.get('--rdx-primary-soft'), 4.5, 'C2 accent/primary-soft');
  atLeast(dark.get('--rdx-accent'), dark.get('--rdx-surface'), 4.5, 'C3+C9 accent/surface');
  assert.match(css, /\[data-theme='dark'\] \.logout-error \{\n  color: var\(--rdx-danger\);\n\}/);
  assert.match(css, /\[data-theme='dark'\] \.page-btn:not\(:disabled\):hover \{\n  color: var\(--rdx-accent\);\n\}/);
  assert.match(plants, /\[data-theme='dark'\] \.detail-link \{ color: var\(--rdx-accent\); \}/);
  assert.match(clients, /\[data-theme='dark'\] \.link-button \{ color: var\(--rdx-accent\); \}/);
  assert.match(inventoryDetail, /\[data-theme='dark'\] \.link-button \{ color: var\(--rdx-accent\); \}/);
});

test('6: C7 — texto informativo ya no usa faint en claro', () => {
  assert.ok(!flow.includes('var(--rdx-text-faint)'), 'flow sin faint');
  assert.ok(!deviceDetail.includes('var(--rdx-text-faint)'), 'device detail sin faint');
  atLeast(light.get('--rdx-text-muted'), light.get('--rdx-background'), 4.5, 'muted/background (flow-link)');
  atLeast(light.get('--rdx-text-muted'), light.get('--rdx-surface'), 4.5, 'muted/surface (no-power)');
});

test('7: sin cambios fuera de C1–C9 — faint, charts, estados y oscuro intactos', () => {
  assert.equal(light.get('--rdx-text-faint'), '#89948e', 'faint claro intacto (marcadores)');
  assert.equal(dark.get('--rdx-text-faint'), '#7e9387', 'faint oscuro intacto');
  for (const [name, hex] of [
    ['--rdx-chart-green', '#174d3c'], ['--rdx-chart-amber', '#d08a22'],
    ['--rdx-chart-blue', '#447bb1'], ['--rdx-chart-purple', '#9070ac'],
    ['--rdx-status-amber', '#f2a20b'], ['--rdx-status-red', '#df3f3f'],
  ]) assert.equal(light.get(name), hex, `${name} intacto (ECharts/estados)`);
  for (const [name, hex] of [
    ['--rdx-success', '#6fce97'], ['--rdx-warning', '#e5a94c'], ['--rdx-danger', '#e07a5f'],
    ['--rdx-provider-hyxi', '#57a9d6'], ['--rdx-provider-growatt', '#62a818'],
    ['--rdx-devices-row-alarm', '#e5a94c'],
  ]) assert.equal(dark.get(name), hex, `${name} oscuro intacto`);
  assert.equal(dark.get('--rdx-on-primary'), '#ffffff', 'on-primary oscuro intacto');
});

test('8: flow-h3 oscuro — título sobre background ≥4.5:1 (antes 3.71:1)', () => {
  atLeast(dark.get('--rdx-accent'), dark.get('--rdx-background'), 4.5, 'accent/background');
  assert.match(flow, /\[data-theme='dark'\] \.flow-header h3 \{ color: var\(--rdx-accent\); \}/);
  assert.match(flow, /\.flow-header h3 \{ margin: 0; color: var\(--rdx-primary\); font-size: 16px; \}/);
});

test('9: provider-logo oscuro — distintivo sobre background ≥4.5:1 (antes 3.71:1)', () => {
  atLeast(dark.get('--rdx-accent'), dark.get('--rdx-background'), 4.5, 'accent/background');
  assert.match(dashboard, /\[data-theme='dark'\] \.provider-logo \{ color: var\(--rdx-accent\); \}/);
  assert.match(dashboard, /\.provider-logo \{ display: grid; place-items: center; width: 48px; height: 48px; flex: 0 0 48px; border-radius: 50%; background: var\(--rdx-background\); font-size: 12px; font-weight: 600; color: var\(--rdx-primary\); \}/);
});
