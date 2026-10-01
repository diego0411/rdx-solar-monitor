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
  const calls = { create: [], update: [], status: [] };
  const deps = {
    ref, computed, onMounted() {}, onUnmounted() {},
    getMyProfile: async () => ({ profile: { role: 'rdx_admin' } }),
    listClients: async () => overrides.clients ?? [],
    createClient: async payload => { calls.create.push(payload); return { id: 'new', active: true, ...payload }; },
    updateClient: async (id, payload) => { calls.update.push([id, payload]); return { id, ...payload }; },
    setClientStatus: async (id, active) => { calls.status.push([id, active]); return { id, active }; },
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
  const calls = { create: [], update: [], plants: [] };
  const deps = {
    ref, computed, onMounted() {}, onUnmounted() {},
    getMyProfile: async () => ({ profile: { role: overrides.role ?? 'rdx_admin' } }),
    apiFetch: async () => overrides.plants ?? [],
    listUsers: async () => [],
    createUser: async payload => { calls.create.push(payload); return { id: 'new', ...payload }; },
    updateUser: async (id, payload) => { calls.update.push([id, payload]); return { id, ...payload }; },
    setUserStatus: async () => ({}),
    setUserPlants: async (id, plant_ids) => { calls.plants.push([id, plant_ids]); return { id, plant_ids }; },
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

test('vista Clientes es catálogo comercial sin plantas ni gestionar', () => {
  assert.match(clientsSource, /<h1>Clientes<\/h1>/);
  assert.match(clientsSource, /Nuevo cliente/);
  for (const header of ['Cliente', 'Celular', 'Email', 'Estado', 'Acciones']) {
    assert.ok(clientsSource.includes(header));
  }
  for (const action of ['Editar', 'Activar', 'Desactivar']) {
    assert.ok(clientsSource.includes(action));
  }
  assert.doesNotMatch(clientsSource, /Plantas asignadas/);
  assert.doesNotMatch(clientsSource, /Gestionar plantas/);
  assert.doesNotMatch(clientsSource, /Asignar planta/);
  assert.doesNotMatch(clientsSource, /plant_ids/);
  assert.doesNotMatch(clientsSource, /eliminar/i);
  assert.doesNotMatch(clientsSource, /plants\//);
});

test('PUT client→plant eliminado del módulo comercial', () => {
  const routes = readFileSync(new URL('../../server/src/routes/clients.routes.js', import.meta.url), 'utf8');
  assert.doesNotMatch(routes, /plants/);
  const service = readFileSync(new URL('../src/services/clients.js', import.meta.url), 'utf8');
  assert.doesNotMatch(service, /assignClientPlant/);
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

  const client = { id: 'c1', name: 'Viejo', active: true };
  view.openEdit(client);
  view.form.value = { name: 'Nuevo nombre' };
  await view.saveForm();
  assert.deepEqual(calls.update[0], ['c1', { name: 'Nuevo nombre' }]);
});

test('contacto: crear con 3 campos, solo nombre, editar y trim', async () => {
  const { view, calls } = setupClients();
  view.openCreate();
  assert.deepEqual(view.form.value, { name: '', phone: '', email: '' });
  view.form.value = { name: '  Comercial  ', phone: '  70000000  ', email: '  ventas@example.test  ' };
  await view.saveForm();
  assert.deepEqual(calls.create[0], { name: 'Comercial', phone: '70000000', email: 'ventas@example.test' });

  const minimal = setupClients();
  minimal.view.openCreate();
  minimal.view.form.value = { name: 'Solo nombre' };
  await minimal.view.saveForm();
  assert.deepEqual(minimal.calls.create[0], { name: 'Solo nombre' });

  const editor = setupClients();
  editor.view.openEdit({ id: 'c1', name: 'Viejo', phone: null, email: null, active: true });
  assert.deepEqual(editor.view.form.value, { name: 'Viejo', phone: '', email: '' });
  editor.view.form.value = { name: 'Viejo', phone: '71000000', email: 'nuevo@example.test' };
  await editor.view.saveForm();
  assert.deepEqual(editor.calls.update[0], ['c1', { name: 'Viejo', phone: '71000000', email: 'nuevo@example.test' }]);
});

test('contacto: email inválido no llama API y NULL se muestra como —', async () => {
  const { view, calls } = setupClients();
  view.openCreate();
  view.form.value = { name: 'X', phone: '', email: 'no-es-email' };
  await view.saveForm();
  assert.equal(calls.create.length, 0);
  assert.match(view.formError.value, /email/i);

  assert.match(clientsSource, /Celular/);
  assert.match(clientsSource, /Email/);
  assert.ok(clientsSource.includes("|| '—'"));
});

test('doble submit bloqueado y errores visibles; activar/desactivar confirma', async () => {
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

  const { view: statusView, calls } = setupClients();
  statusView.askStatus({ id: 'c1', name: 'C', active: true });
  await statusView.applyStatus();
  assert.deepEqual(calls.status[0], ['c1', false]);
});

test('UsersView sin Cliente: ofrece Plantas con acceso y envía plant_ids', async () => {
  assert.doesNotMatch(usersSource, /Cliente \*/);
  assert.doesNotMatch(usersSource, /id="user-client"/);
  assert.doesNotMatch(usersSource, /requiresClient/);
  assert.doesNotMatch(usersSource, /listClients/);
  assert.match(usersSource, /Plantas con acceso/);
  const { view, calls } = setupUsers({ plants: [{ id: 'p1', name: 'Planta 1' }] });
  view.openCreate();
  assert.deepEqual(view.form.value.plant_ids, []);
  view.form.value = { display_name: 'N', email: 'n@example.test', role: 'client_user', plant_ids: ['p1'] };
  view.password.value = 'Test-only-Password-42!';
  view.confirmPassword.value = view.password.value;
  await view.saveForm();
  assert.deepEqual(calls.create[0].plant_ids, ['p1']);
  assert.ok(!('client_id' in calls.create[0]));
});

test('UsersView editar actualiza plantas por endpoint dedicado', async () => {
  const { view, calls } = setupUsers({ plants: [{ id: 'p1', name: 'Planta 1' }] });
  view.openEdit({ id: 'u1', display_name: 'U', email: 'u@example.test', role: 'client_user', plant_ids: ['p1'] });
  assert.deepEqual(view.form.value.plant_ids, ['p1']);
  view.form.value.plant_ids = [];
  await view.saveForm();
  assert.deepEqual(calls.plants[0], ['u1', []]);
});

test('/users y enlace Usuarios solo para rdx_admin en esta fase', () => {
  const router = readFileSync(new URL('../src/router/index.js', import.meta.url), 'utf8');
  assert.match(router, /to\.name === 'users' && role !== 'rdx_admin'/);
  assert.doesNotMatch(router, /role !== 'client_admin'/);
  const layout = readFileSync(new URL('../src/layouts/AppLayout.vue', import.meta.url), 'utf8');
  assert.match(layout, /showUsers\.value = me\?\.profile\?\.role === 'rdx_admin'/);
});

test('Inventario ya no usa include=plant_ids; contexto independiente', () => {
  const detail = readFileSync(new URL('../src/views/InventoryDetailView.vue', import.meta.url), 'utf8');
  assert.doesNotMatch(detail, /includePlantIds/);
  assert.doesNotMatch(detail, /plantsForClient/);
  assert.match(detail, /Sin cliente/);
  assert.match(detail, /Sin planta/);
});
