import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { ref, computed } from 'vue';

const { descriptor } = parse(readFileSync(new URL('../src/views/MaintenanceView.vue', import.meta.url), 'utf8'));
const code = compileScript(descriptor, { id: 'maintenance-test' }).content
  .replace(/^import .*;$/gm, '').replace('export default', 'return');

const DAY = 24 * 60 * 60 * 1000;
const iso = offset => new Date(Date.now() + offset).toISOString();

function setup({ role = 'client_admin', visits = [], plants = [], create = null } = {}) {
  const deps = {
    ref, computed, onMounted() {}, onUnmounted() {},
    getMyProfile: async () => ({ profile: { role } }),
    apiFetch: async () => plants,
    listMaintenanceVisits: async () => visits,
    createMaintenanceVisit: create ?? (async payload => ({ id: 'new', status: 'scheduled', ...payload })),
  };
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps));
  return component.setup({}, { expose() {} });
}

function visit(overrides = {}) {
  return {
    id: 'v', plant_id: 'p', title: 'T', status: 'scheduled',
    priority: 'normal', scheduled_at: null, technician_name: null,
    service_amount: null, currency: 'BOB', next_maintenance_at: null,
    ...overrides,
  };
}

test('carga inicial: loading, rol admin y listado', async () => {
  const view = setup({ visits: [visit({ id: '1' })], plants: [{ id: 'p', name: 'Planta 1' }] });
  assert.equal(view.loading.value, true);
  await view.load();
  assert.equal(view.loading.value, false);
  assert.equal(view.error.value, '');
  assert.equal(view.canCreate.value, true);
  assert.equal(view.filtered.value.length, 1);
  assert.equal(view.plantName('p'), 'Planta 1');
});

test('regresión: con 0 visitas el selector y filtro muestran las plantas existentes', async () => {
  const view = setup({
    visits: [],
    plants: [{ id: 'p1', name: 'Planta 1' }, { id: 'p2', name: 'Planta 2' }],
  });
  await view.load();
  assert.deepEqual(view.plantOptions.value, [
    { id: 'p1', name: 'Planta 1' },
    { id: 'p2', name: 'Planta 2' },
  ]);
  view.openCreate();
  assert.equal(view.showForm.value, true);
  assert.equal(view.plantName('p1'), 'Planta 1');
  assert.equal(view.plantName('p2'), 'Planta 2');
});

test('KPIs: programados, próximos 30 días, vencidos y completados', async () => {
  const view = setup({
    visits: [
      visit({ id: '1', scheduled_at: iso(5 * DAY) }),
      visit({ id: '2', scheduled_at: iso(-2 * DAY) }),
      visit({ id: '3', scheduled_at: iso(60 * DAY) }),
      visit({ id: '4', status: 'in_progress', scheduled_at: iso(1 * DAY) }),
      visit({ id: '5', status: 'completed', scheduled_at: iso(-40 * DAY) }),
      visit({ id: '6', status: 'cancelled', scheduled_at: iso(-1 * DAY) }),
    ],
  });
  await view.load();
  assert.equal(view.kpis.value.scheduled, 3);
  assert.equal(view.kpis.value.upcoming, 1);
  assert.equal(view.kpis.value.overdue, 1);
  assert.equal(view.kpis.value.completed, 1);
});

test('límite de 30 días: dentro cuenta, fuera no', async () => {
  const view = setup({
    visits: [
      visit({ id: '1', scheduled_at: iso(30 * DAY - 60000) }),
      visit({ id: '2', scheduled_at: iso(31 * DAY) }),
    ],
  });
  await view.load();
  assert.equal(view.kpis.value.upcoming, 1);
});

test('traducciones de estado y prioridad', async () => {
  const view = setup();
  await view.load();
  assert.equal(view.statusLabel('scheduled'), 'Programado');
  assert.equal(view.statusLabel('in_progress'), 'En progreso');
  assert.equal(view.statusLabel('completed'), 'Completado');
  assert.equal(view.statusLabel('cancelled'), 'Cancelado');
  assert.equal(view.priorityLabel('low'), 'Baja');
  assert.equal(view.priorityLabel('normal'), 'Normal');
  assert.equal(view.priorityLabel('high'), 'Alta');
  assert.equal(view.priorityLabel('urgent'), 'Urgente');
});

test('botón abre formulario con defaults normal/BOB; client_user no ve botón', async () => {
  const view = setup();
  await view.load();
  assert.equal(view.showForm.value, false);
  view.openCreate();
  assert.equal(view.showForm.value, true);
  assert.equal(view.form.value.priority, 'normal');
  assert.equal(view.form.value.currency, 'BOB');
  view.closeForm();
  assert.equal(view.showForm.value, false);
  const userView = setup({ role: 'client_user' });
  await userView.load();
  assert.equal(userView.canCreate.value, false);
});

test('campos obligatorios y monto negativo rechazados', async () => {
  const view = setup();
  await view.load();
  view.openCreate();
  await view.saveForm();
  assert.equal(view.formError.value, 'Selecciona una planta.');
  assert.equal(view.showForm.value, true);
  view.form.value.plant_id = 'p';
  view.form.value.title = '   ';
  await view.saveForm();
  assert.equal(view.formError.value, 'El título es obligatorio.');
  view.form.value.title = 'Revisión';
  view.form.value.service_amount = '-5';
  await view.saveForm();
  assert.equal(view.formError.value, 'El monto debe ser mayor o igual a 0.');
});

test('payload correcto y éxito actualiza listado y KPIs', async () => {
  let sent = null;
  const view = setup({
    visits: [],
    plants: [{ id: 'p', name: 'Planta 1' }],
    create: async payload => {
      sent = payload;
      return { id: 'n1', status: 'scheduled', ...payload };
    },
  });
  await view.load();
  view.openCreate();
  view.form.value.plant_id = 'p';
  view.form.value.title = '  Revisión anual ';
  view.form.value.scheduled_at = '2026-10-05T10:00';
  await view.saveForm();
  assert.deepEqual(sent, {
    plant_id: 'p',
    title: 'Revisión anual',
    priority: 'normal',
    currency: 'BOB',
    scheduled_at: new Date('2026-10-05T10:00').toISOString(),
  });
  assert.equal(view.showForm.value, false);
  assert.equal(view.visits.value.length, 1);
  assert.equal(view.kpis.value.scheduled, 1);
  assert.equal(view.filtered.value.length, 1);
});

test('monto vacío se omite y fechas inválidas no se envían', async () => {
  let sent = null;
  const view = setup({ create: async payload => {
    sent = payload;
    return { id: 'n2', status: 'scheduled', ...payload };
  } });
  await view.load();
  view.openCreate();
  view.form.value.plant_id = 'p';
  view.form.value.title = 'T';
  view.form.value.service_amount = '';
  view.form.value.scheduled_at = 'no-fecha';
  await view.saveForm();
  assert.equal('service_amount' in sent, false);
  assert.equal('scheduled_at' in sent, false);
});

test('error conserva formulario abierto; doble submit bloqueado', async () => {
  let calls = 0;
  const view = setup({ create: async () => {
    calls += 1;
    throw Object.assign(new Error('x'), { status: 500 });
  } });
  await view.load();
  view.openCreate();
  view.form.value.plant_id = 'p';
  view.form.value.title = 'T';
  await view.saveForm();
  assert.equal(calls, 1);
  assert.equal(view.showForm.value, true);
  assert.ok(view.formError.value);

  let release;
  const hanging = setup({ create: () => new Promise(resolve => { release = resolve; }) });
  await hanging.load();
  hanging.openCreate();
  hanging.form.value.plant_id = 'p';
  hanging.form.value.title = 'T';
  const first = hanging.saveForm();
  assert.equal(hanging.formSaving.value, true);
  await hanging.saveForm();
  release({ id: 'n3', status: 'scheduled' });
  await first;
  assert.equal(hanging.showForm.value, false);
});

test('listado vacío y error de carga', async () => {
  const empty = setup({ visits: [] });
  await empty.load();
  assert.equal(empty.filtered.value.length, 0);
  assert.equal(empty.error.value, '');

  const deps = { ref, computed, onMounted() {}, onUnmounted() {},
    getMyProfile: async () => ({ profile: { role: 'client_admin' } }),
    apiFetch: async () => [],
    listMaintenanceVisits: async () => { throw new Error('down'); } };
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps));
  const brokenView = component.setup({}, { expose() {} });
  await brokenView.load();
  assert.equal(brokenView.loading.value, false);
  assert.ok(brokenView.error.value);
});
