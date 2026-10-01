import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const layout = readFileSync(new URL('../src/layouts/AppLayout.vue', import.meta.url), 'utf8');
const router = readFileSync(new URL('../src/router/index.js', import.meta.url), 'utf8');

test('menú respeta permisos: client_user ve solo módulos concedidos', () => {
  assert.match(layout, /function canSee\(module\)/);
  assert.match(layout, /v-if="canSee\('dashboard'\)"/);
  assert.match(layout, /v-if="canSee\('plants'\)"/);
  assert.match(layout, /v-if="canSee\('devices'\)"/);
  assert.match(layout, /v-if="canSee\('maintenance'\)"/);
  assert.match(layout, /v-if="canSee\('inventory'\)"/);
});

test('mapa sigue plants y alarmas siguen devices en menú', () => {
  const mapLine = layout.split('\n').find(line => line.includes('to="/map"'));
  assert.match(mapLine, /canSee\('plants'\)/);
  const alarmsLine = layout.split('\n').find(line => line.includes('to="/alarms"'));
  assert.match(alarmsLine, /canSee\('devices'\)/);
});

test('router bloquea URL manual sin permiso sin generar loop', () => {
  assert.match(router, /map: 'plants'/);
  assert.match(router, /alarms: 'devices'/);
  assert.match(router, /role === 'client_user'/);
  assert.match(router, /module_permissions/);
  assert.match(router, /return \{ name: 'dashboard' \}/);
  assert.match(router, /to\.name !== 'dashboard'/);
});
