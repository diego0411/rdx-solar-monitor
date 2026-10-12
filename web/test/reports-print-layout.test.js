import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { ref, computed } from 'vue';

const { descriptor } = parse(readFileSync(new URL('../src/views/ReportsView.vue', import.meta.url), 'utf8'));
const code = compileScript(descriptor, { id: 'reports-print-layout-test' }).content
  .replace(/^import .*;$/gm, '').replace('export default', 'return');

function setup({ printThrows = false } = {}) {
  const waits = [], listeners = new Map(), printed = [];
  let unmount;
  const section = { style: { cssText: 'padding: 20px;' } };
  const canvas = {};
  const chart = { resize() {}, isDisposed: () => false };
  const document = {
    title: 'RDX Solar Monitor',
    documentElement: {
      theme: 'dark',
      hasAttribute() { return this.theme !== null; },
      getAttribute() { return this.theme; },
      setAttribute(_, value) { this.theme = value; },
      removeAttribute() { this.theme = null; },
    },
  };
  const window = {
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name) { listeners.delete(name); },
    dispatchEvent() {},
    print() {
      printed.push({ style: section.style.cssText, theme: document.documentElement.theme });
      if (printThrows) throw new Error('dialog unavailable');
      // Cancelar también retorna del diálogo y puede emitir afterprint.
      listeners.get('afterprint')?.();
    },
  };
  const deps = {
    ref, computed, onMounted: fn => fn(), onUnmounted: fn => { unmount = fn; },
    apiFetch: () => { throw new Error('Printing must not fetch'); },
    getPlantsCatalog: async () => [], PlantEnergyHistory: {},
    buildReportIndicators: () => null, clearRdxColorCache() {},
    getInstanceByDom: el => el === canvas ? chart : null,
    document, window, CustomEvent: class {},
    setTimeout: fn => { waits.push(fn); },
  };
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps));
  const view = component.setup({}, { expose() {} });
  if (view.reportsRoot) view.reportsRoot.value = {
    querySelector: selector => selector === '.energy-section' ? section : canvas,
  };
  view.preview.value = { plantName: 'Arturo Saunero', period: 'month', date: '2026-09-01', type: 'energy' };
  view.history.value = { buckets: [] };
  return { view, section, document, printed, unmount: () => unmount(), settle: () => waits.splice(0).forEach(fn => fn()) };
}

test('prepara ancho A4 antes del diálogo y restaura estilos y tema al cancelar', async () => {
  const s = setup();
  const pending = s.view.handlePrint();
  s.settle();
  await pending;
  assert.equal(s.printed.length, 1);
  assert.match(s.printed[0].style, /186mm/);
  assert.equal(s.printed[0].theme, null);
  assert.equal(s.section.style.cssText, 'padding: 20px;');
  assert.equal(s.document.documentElement.theme, 'dark');
  assert.equal(s.document.title, 'RDX Solar Monitor');
});

test('clics repetidos durante preparación no abren diálogos concurrentes', async () => {
  const s = setup();
  const first = s.view.handlePrint();
  const second = s.view.handlePrint();
  s.settle();
  await Promise.all([first, second]);
  assert.equal(s.printed.length, 1);
  assert.equal(s.document.documentElement.theme, 'dark');
});

test('desmontar durante preparación restaura estado y evita impresión tardía', async () => {
  const s = setup();
  const pending = s.view.handlePrint();
  s.unmount();
  s.settle();
  await pending;
  assert.equal(s.printed.length, 0);
  assert.equal(s.section.style.cssText, 'padding: 20px;');
  assert.equal(s.document.documentElement.theme, 'dark');
});

test('error del diálogo también restaura estilos, tema y título', async () => {
  const s = setup({ printThrows: true });
  const pending = s.view.handlePrint();
  s.settle();
  await assert.rejects(pending, /dialog unavailable/);
  assert.equal(s.section.style.cssText, 'padding: 20px;');
  assert.equal(s.document.documentElement.theme, 'dark');
  assert.equal(s.document.title, 'RDX Solar Monitor');
});

test('cambiar filtros durante preparación cancela la impresión de la foto anterior', async () => {
  const s = setup();
  const pending = s.view.handlePrint();
  s.view.invalidatePreview();
  s.settle();
  await pending;
  assert.equal(s.printed.length, 0);
  assert.equal(s.section.style.cssText, 'padding: 20px;');
  assert.equal(s.document.documentElement.theme, 'dark');
});

test('tema claro también prepara el ancho y se conserva después del diálogo', async () => {
  const s = setup();
  s.document.documentElement.theme = null;
  const pending = s.view.handlePrint();
  assert.equal(s.printed.length, 0, 'espera de layout incluso sin cambio de paleta');
  s.settle();
  await pending;
  assert.match(s.printed[0].style, /186mm/);
  assert.equal(s.section.style.cssText, 'padding: 20px;');
  assert.equal(s.document.documentElement.theme, null);
});

test('preparación cancelada no restaura ni cancela una nueva sesión de impresión', async () => {
  const s = setup();
  const old = s.view.handlePrint();
  s.view.invalidatePreview();
  s.view.preview.value = { plantName: 'Arturo Saunero', period: 'month', date: '2026-09-01', type: 'energy' };
  s.view.history.value = { buckets: [] };
  const current = s.view.handlePrint();
  s.settle();
  await Promise.all([old, current]);
  assert.equal(s.printed.length, 1);
  assert.match(s.printed[0].style, /186mm/);
  assert.equal(s.printed[0].theme, null);
  assert.equal(s.section.style.cssText, 'padding: 20px;');
  assert.equal(s.document.documentElement.theme, 'dark');
});
