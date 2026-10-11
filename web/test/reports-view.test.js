import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ECO-04D1: contrato estático del módulo Reportes (sin DOM ni red).
// Estructura y autorización con mecanismos existentes; sin generación real.

const router = readFileSync(new URL('../src/router/index.js', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../src/layouts/AppLayout.vue', import.meta.url), 'utf8');
const view = readFileSync(new URL('../src/views/ReportsView.vue', import.meta.url), 'utf8');

test('1: ruta /reports registrada con carga diferida y módulo reports', () => {
  assert.match(router, /\{ path: '\/reports', name: 'reports', component: \(\) => import\('..\/views\/ReportsView\.vue'\) \}/);
  assert.match(router, /reports: 'reports'/);
});

test('2: sin permiso de reports se redirige al dashboard (mecanismo existente)', () => {
  assert.match(router, /role === 'client_user'/);
  assert.match(router, /module_permissions/);
  assert.match(router, /return \{ name: 'dashboard' \}/);
});

test('3: navegación y contexto en Monitoreo con permiso', () => {
  const reportsLine = layout.split('\n').find(line => line.includes('to="/reports"'));
  assert.match(reportsLine, /canSee\('reports'\)/);
  assert.match(layout, /reports: 'monitoreo'/);
  assert.match(layout, /reports: \{ section: 'Monitoreo', label: 'Reportes' \}/);
});

test('4: selectores de planta, periodo, fecha y tipo con validación', () => {
  assert.match(view, /<h1>Reportes<\/h1>/);
  assert.match(view, /getPlantsCatalog/);
  assert.match(view, /\{ key: 'day', label: 'Día' \}/);
  assert.match(view, /\{ key: 'week', label: 'Semana' \}/);
  assert.match(view, /\{ key: 'month', label: 'Mes' \}/);
  assert.match(view, /\{ key: 'year', label: 'Año' \}/);
  assert.match(view, /\{ key: 'energy', label: 'Energético' \}/);
  assert.match(view, /\{ key: 'energy_economics', label: 'Energético \+ económico' \}/);
  assert.match(view, /type="date"/);
  assert.match(view, /:disabled="!canGenerate"/);
});

test('5: vista previa vacía sin generación real ni datos', () => {
  assert.match(view, /Vista previa/);
  assert.match(view, /aún no está habilitada/);
  assert.ok(!view.includes('/economics'), 'sin consulta económica');
  assert.ok(!view.includes('energy-history?'), 'sin consulta energética directa (la hace el componente)');
  assert.ok(!view.includes('buildReportIndicators'), 'sin presentación de datos');
  assert.ok(!view.includes('jsPDF') && !view.includes('pdfmake'), 'sin PDF');
});
