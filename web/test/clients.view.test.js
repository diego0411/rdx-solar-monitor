import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { computed, ref } from 'vue';

const clientsSource = readFileSync(new URL('../src/views/ClientsView.vue', import.meta.url), 'utf8');
const { descriptor: clientsDescriptor } = parse(clientsSource);
const clientsCode = compileScript(clientsDescriptor, { id: 'clients-view-test' }).content
  .replace(/^import[^;]*;$/gm, '').replace('export default', 'return');

function setupClients(overrides = {}) {
  const calls = { create: [], update: [], status: [], assign: [] };
  const deps = {
    ref, computed, onMounted() {}, onUnmounted() {},
    getMyProfile: async () => ({ profile: { role: 'rdx_admin' } }),
    apiFetch: async () => overrides.plants ?? [],
    listClients: async () => overrides.clients ?? [],
    createClient: async payload => { calls.create.push(payload); return { id: 'new', active: true, ...payload }; },
    updateClient: async (id, payload) => { calls.update.push([id, payload]); return { id, ...payload }; },
    setClientStatus: async (id, active) => { calls.status.push([id, active]); return { id, active }; },
    assignClientPlant: async (id, plantId) => { calls.assign.push([id, plantId]); return { client_id: id, plant_id: plantId }; },
    ...overrides.deps,
  };
  const component = new Function(...Object.keys(deps), clientsCode)(...Object.values(deps));
  const view = component.setup({}, { expose() {} });
  return { view, calls };
}

const usersSource = readFileSync(new URL('../src/views/UsersView.vue', import.meta.url), 'utf8');
const { descriptor: usersDescriptor } = parse(usersSource);
const usersCode = compileScript(usersDescriptor, { id: 'users-multiclient-test' }).content
  .replace(/^import[^;]*;$/gm, '').replace('export default', 'return');

function setupUsers(overrides = {}) {
  const calls = [];
  const deps = {
    ref, computed, onMounted() {}, onUnmounted() {},
    getMyProfile: async () => ({ profile: { role: overrides.role ?? 'rdx_admin' } }),
    listUsers: async () => [],
    listClients: async () => overrides.clients ?? [],
    createUser: async payload => { calls.push(payload); return { id: 'new', ...payload }; },
    updateUser: async () => ({}),
    setUserStatus: async () => ({}),
  };
  const component = new Function(...Object.keys(deps), usersCode)(...Object.values(deps));
  return { view: component.setup({}, { expose() {} }), calls };
}

test('/clients disponible solo para rdx_admin y enlace Clientes solo rdx_admin', () => {
  const router = readFileSync(new URL('../src/router/index.js', import.meta.url), 'utf8');
  assert.match(router, /path: '\/clients'/);
  assert.match(router, /name: 'clients'/);
  assert.match(router, /to\.name === 'clients'/);
  const layout = readFileSync(new URL('../src/layouts/AppLayout.vue', import.meta.url), 'utf8');
  assert.match(layout, /to="\/clients"/);
  assert.match(layout, />Clientes</);
  assert.match(layout, /v-if="showClients"/);
  assert.match(layout, /showClients\.value = me\?\.profile\?\.role === 'rdx_admin'/);
});

test('vista Clientes lista activos/inactivos con acciones y sin eliminar ni desasignar', () => {
  assert.match(clientsSource, /<h1>Clientes<\/h1>/);
  assert.match(clientsSource, /Nuevo cliente/);
  for (const header of ['Cliente', 'Estado', 'Plantas asignadas', 'Acciones']) {
    assert.ok(clientsSource.includes(header));
  }
  for (const action of ['Editar', 'Activar', 'Desactivar', 'Gestionar plantas', 'Asignar planta']) {
    assert.ok(clientsSource.includes(action));
  }
  assert.doesNotMatch(clientsSource, /eliminar/i);
  assert.doesNotMatch(clientsSource, /desasignar/i);
  assert.doesNotMatch(clientsSource, /DELETE/i);
});

test('crear y editar refrescan desde backend con trim y validación visible', async () => {
  const { view, calls } = setupClients();
  view.openCreate();
  view.form.value = { name: '   ' };
  await view.saveForm();
  assert.match(view.formError.value, /obligatorio/);
  assert.equal(calls.create.length, 0);

  view.form.value = { name: '  Nuevo  ' };
  await view.saveForm();
  assert.equal(calls.create[0].name, 'Nuevo');

  const client = { id: 'c1', name: 'Viejo', active: true, plant_ids: [] };
  view.openEdit(client);
  view.form.value = { name: 'Nuevo nombre' };
  await view.saveForm();
  assert.deepEqual(calls.update[0], ['c1', { name: 'Nuevo nombre' }]);
});

test('doble submit bloqueado y errores visibles en guardar y asignar', async () => {
  let release;
  const { view } = setupClients({
    deps: { createClient: () => new Promise(resolve => { release = resolve; }) },
  });
  view.openCreate();
  view.form.value = { name: 'Bloqueo' };
  const pending = view.saveForm();
  await view.saveForm();
  view.closeForm();
  assert.equal(view.showForm.value, true);
  release({ id: 'new', name: 'Bloqueo' });
  await pending;
  assert.equal(view.showForm.value, false);

  const failing = setupClients({
    deps: { createClient: async () => { throw Object.assign(new Error('dupe'), { status: 409, detail: 'Ya existe' }); } },
  });
  failing.view.openCreate();
  failing.view.form.value = { name: 'Duplicado' };
  await failing.view.saveForm();
  assert.equal(failing.view.showForm.value, true);
  assert.match(failing.view.formError.value, /Ya existe/);

  const { view: plantView } = setupClients({
    clients: [{ id: 'c1', name: 'C', active: true, plant_ids: [] }],
    plants: [{ id: 'p1', name: 'P1' }],
  });
  plantView.clients.value = [{ id: 'c1', name: 'C', active: true, plant_ids: [] }];
  plantView.plants.value = [{ id: 'p1', name: 'P1' }];
  plantView.openPlants(plantView.clients.value[0]);
  await plantView.assignPlant();
  assert.match(plantView.plantError.value, /Selecciona/);
});

test('cliente inactivo no permite nuevas asignaciones en frontend', async () => {
  const { view } = setupClients();
  view.clients.value = [];
  view.plants.value = [{ id: 'p1', name: 'P1' }];
  view.openPlants({ id: 'c-off', name: 'Off', active: false, plant_ids: [] });
  view.selectedPlantId.value = 'p1';
  await view.assignPlant();
  assert.match(view.plantError.value, /Activa el cliente/);
});

test('UsersView muestra Cliente * para rdx_admin y envía client_id', async () => {
  assert.match(usersSource, /Cliente \*/);
  assert.match(usersSource, /id="user-client"/);
  const { view, calls } = setupUsers({ clients: [{ id: 'c1', name: 'C1' }] });
  view.myRole.value = 'rdx_admin';
  view.openCreate();
  assert.equal(view.requiresClient.value, true);
  view.form.value = { display_name: 'N', email: 'n@example.test', role: 'client_user', client_id: 'c1' };
  view.password.value = 'Test-only-Password-42!';
  view.confirmPassword.value = view.password.value;
  await view.saveForm();
  assert.equal(calls[0].client_id, 'c1');

  const missing = setupUsers();
  missing.view.myRole.value = 'rdx_admin';
  missing.view.openCreate();
  missing.view.form.value = { display_name: 'N', email: 'n@example.test', role: 'client_admin', client_id: '' };
  missing.view.password.value = 'Test-only-Password-42!';
  missing.view.confirmPassword.value = missing.view.password.value;
  await missing.view.saveForm();
  assert.match(missing.view.formError.value, /cliente/i);
});

test('client_admin no puede seleccionar otro cliente', async () => {
  const { view, calls } = setupUsers({ role: 'client_admin' });
  view.myRole.value = 'client_admin';
  view.openCreate();
  assert.equal(view.requiresClient.value, false);
  view.form.value = { display_name: 'N', email: 'n@example.test', role: 'client_user', client_id: '' };
  view.password.value = 'Test-only-Password-42!';
  view.confirmPassword.value = view.password.value;
  await view.saveForm();
  assert.ok(!('client_id' in calls[0]));
});

test('Inventario sigue consumiendo contrato existente sin regresión', () => {
  const service = readFileSync(new URL('../src/services/clients.js', import.meta.url), 'utf8');
  assert.match(service, /includePlantIds/);
  assert.match(service, /\/clients/);
  const detail = readFileSync(new URL('../src/views/InventoryDetailView.vue', import.meta.url), 'utf8');
  assert.match(detail, /listClients\(\{/);
  assert.match(detail, /includePlantIds/);
});
