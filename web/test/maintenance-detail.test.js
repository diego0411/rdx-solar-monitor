import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { ref, computed } from 'vue';

const { descriptor } = parse(readFileSync(new URL('../src/views/MaintenanceDetailView.vue', import.meta.url), 'utf8'));
const code = compileScript(descriptor, { id: 'maintenance-detail-test' }).content
  .replace(/^import[^;]*;$/gm, '').replace('export default', 'return');

function setup({ role = 'client_admin', visit = null, visitError = null, plants = [], devices = [], activityApi = {}, updateVisit = null, updateStatus = null } = {}) {
  const deps = {
    ref, computed, onMounted() {}, onUnmounted() {},
    useRoute: () => ({ params: { id: 'v1' } }),
    getMyProfile: async () => ({ profile: { role } }),
    apiFetch: async path => (String(path).startsWith('/devices') ? devices : plants),
    getMaintenanceVisit: async () => {
      if (visitError) throw visitError;
      return visit;
    },
    deviceDisplayName: device => device?.name ?? device?.serial_number ?? 'Dispositivo',
    createMaintenanceActivity: activityApi.create ?? (async (visitId, payload) => ({ id: 'n1', ...payload })),
    updateMaintenanceActivity: activityApi.update ?? (async (visitId, id, payload) => ({ id, ...payload })),
    deleteMaintenanceActivity: activityApi.remove ?? (async () => ({ deleted: true })),
    updateMaintenanceVisit: updateVisit ?? (async (id, payload) => ({ id, ...payload })),
    updateMaintenanceStatus: updateStatus ?? (async (id, status) => ({ id, status })),
  };
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps));
  return component.setup({}, { expose() {} });
}

function baseVisit(overrides = {}) {
  return {
    id: 'v1', plant_id: 'p', title: 'Revisión anual', status: 'scheduled',
    priority: 'high', description: 'Desc', technician_name: 'Juan',
    general_observations: null, scheduled_at: '2026-10-05T10:00:00.000Z',
    created_at: '2026-09-20T10:00:00.000Z', completed_at: null,
    service_amount: 1500, currency: 'BOB',
    next_maintenance_at: null, next_maintenance_notes: null,
    activities: [], ...overrides,
  };
}

test('carga y render del detalle con planta', async () => {
  const view = setup({ visit: baseVisit(), plants: [{ id: 'p', name: 'Planta 1' }] });
  assert.equal(view.loading.value, true);
  await view.load();
  assert.equal(view.loading.value, false);
  assert.equal(view.visit.value.title, 'Revisión anual');
  assert.equal(view.plantName.value, 'Planta 1');
  assert.equal(view.notFound.value, false);
  assert.equal(view.error.value, '');
});

test('traducciones de estado, prioridad y tipo de actividad', async () => {
  const view = setup({ visit: baseVisit() });
  await view.load();
  assert.equal(view.statusLabel('in_progress'), 'En progreso');
  assert.equal(view.priorityLabel('urgent'), 'Urgente');
  assert.equal(view.activityTypeLabel('corrective'), 'Correctivo');
  assert.equal(view.activityTypeLabel('cleaning'), 'Limpieza');
});

test('información económica con y sin monto', async () => {
  const withAmount = setup({ visit: baseVisit({ service_amount: 2500, currency: 'USD' }) });
  await withAmount.load();
  assert.equal(withAmount.visit.value.service_amount, 2500);
  const without = setup({ visit: baseVisit({ service_amount: null }) });
  await without.load();
  assert.equal(without.visit.value.service_amount, null);
  assert.equal(without.text(null), '—');
});

test('activities: dispositivo, planta completa y vacío', async () => {
  const view = setup({ visit: baseVisit({ activities: [
    { id: 'a1', activity_type: 'preventive', title: 'Limpieza', device_id: 'd123456789', work_performed: 'Ok' },
    { id: 'a2', activity_type: 'inspection', title: 'General', device_id: null },
  ] }) });
  await view.load();
  assert.equal(view.activities.value.length, 2);
  assert.equal(view.deviceLabel('d123456789'), 'Dispositivo d1234567');
  assert.equal(view.deviceLabel(null), 'Planta completa');
  const empty = setup({ visit: baseVisit({ activities: [] }) });
  await empty.load();
  assert.equal(empty.activities.value.length, 0);
});

test('botones visibles para admins, ocultos para client_user', async () => {
  for (const role of ['rdx_admin', 'client_admin']) {
    const view = setup({ role, visit: baseVisit() });
    await view.load();
    assert.equal(view.canManage.value, true);
  }
  const userView = setup({ role: 'client_user', visit: baseVisit() });
  await userView.load();
  assert.equal(userView.canManage.value, false);
});

test('error genérico y 404', async () => {
  const failing = setup({ visitError: new Error('down') });
  await failing.load();
  assert.equal(failing.loading.value, false);
  assert.ok(failing.error.value);
  assert.equal(failing.notFound.value, false);
  const missing = setup({ visitError: Object.assign(new Error('x'), { status: 404 }) });
  await missing.load();
  assert.equal(missing.notFound.value, true);
  assert.equal(missing.error.value, '');
});

const plantDevices = [
  { id: 'd1', plant_id: 'p', name: 'Inversor 1', serial_number: 'SN1' },
  { id: 'd2', plant_id: 'other', name: 'Otro', serial_number: 'SN2' },
];

test('abrir Agregar: default inspection + Planta completa', async () => {
  const view = setup({ visit: baseVisit(), devices: plantDevices });
  await view.load();
  assert.equal(view.showActivityForm.value, false);
  view.openCreateActivity();
  assert.equal(view.showActivityForm.value, true);
  assert.equal(view.activityForm.value.activity_type, 'inspection');
  assert.equal(view.activityScope.value, 'plant');
  assert.equal(view.editingActivity.value, null);
  await view.ensureDevices();
  assert.equal(view.plantDevices.value.length, 1);
  assert.equal(view.plantDevices.value[0].id, 'd1');
});

test('title requerido y alcance dispositivo exige device_id', async () => {
  const view = setup({ visit: baseVisit() });
  await view.load();
  view.openCreateActivity();
  await view.saveActivityForm();
  assert.equal(view.activityError.value, 'El título es obligatorio.');
  view.activityForm.value.title = 'T';
  view.activityScope.value = 'device';
  await view.saveActivityForm();
  assert.equal(view.activityError.value, 'Selecciona un dispositivo.');
  assert.equal(view.showActivityForm.value, true);
});

test('crear actividad de planta completa (device_id null)', async () => {
  let sent = null;
  const view = setup({
    visit: baseVisit(),
    activityApi: { create: async (visitId, payload) => {
      sent = { visitId, payload };
      return { id: 'n1', ...payload };
    } },
  });
  await view.load();
  view.openCreateActivity();
  view.activityForm.value.title = '  Revisión  ';
  view.activityForm.value.work_performed = 'Limpieza';
  await view.saveActivityForm();
  assert.deepEqual(sent.payload, {
    activity_type: 'inspection', title: 'Revisión', device_id: null, work_performed: 'Limpieza',
  });
  assert.equal(view.showActivityForm.value, false);
  assert.equal(view.activities.value.length, 1);
});

test('crear con dispositivo y editar cambiando a Planta completa', async () => {
  const view = setup({
    visit: baseVisit({ activities: [
      { id: 'a1', activity_type: 'preventive', title: 'Vieja', device_id: 'd1' },
    ] }),
    devices: plantDevices,
    activityApi: {
      create: async (visitId, payload) => ({ id: 'n1', ...payload }),
      update: async (visitId, id, payload) => ({ id, ...payload }),
    },
  });
  await view.load();
  view.openCreateActivity();
  view.activityScope.value = 'device';
  view.activityForm.value.title = 'Con equipo';
  view.activityForm.value.device_id = 'd1';
  await view.saveActivityForm();
  assert.equal(view.activities.value.length, 2);
  assert.equal(view.activities.value[1].device_id, 'd1');

  view.openEditActivity(view.activities.value[0]);
  assert.equal(view.activityForm.value.title, 'Vieja');
  assert.equal(view.activityScope.value, 'device');
  view.activityScope.value = 'plant';
  await view.saveActivityForm();
  assert.equal(view.activities.value[0].device_id, null);
  assert.equal(view.activities.value.length, 2);
});

test('eliminar con confirmación actualiza local; cancelar no llama API', async () => {
  let calls = 0;
  const view = setup({
    visit: baseVisit({ activities: [{ id: 'a1', activity_type: 'inspection', title: 'X', device_id: null }] }),
    activityApi: { remove: async () => { calls += 1; return { deleted: true }; } },
  });
  await view.load();
  view.askDeleteActivity(view.activities.value[0]);
  assert.equal(view.confirmingDelete.value.id, 'a1');
  view.closeDeleteConfirm();
  assert.equal(view.confirmingDelete.value, null);
  assert.equal(calls, 0);
  view.askDeleteActivity(view.activities.value[0]);
  await view.applyDeleteActivity();
  assert.equal(calls, 1);
  assert.equal(view.activities.value.length, 0);
});

test('client_user no ve acciones; error conserva formulario; doble submit bloqueado', async () => {
  const userView = setup({ role: 'client_user', visit: baseVisit() });
  await userView.load();
  assert.equal(userView.canManage.value, false);

  let calls = 0;
  const view = setup({
    visit: baseVisit(),
    activityApi: { create: async () => {
      calls += 1;
      throw Object.assign(new Error('x'), { status: 400 });
    } },
  });
  await view.load();
  view.openCreateActivity();
  view.activityForm.value.title = 'T';
  await view.saveActivityForm();
  assert.equal(calls, 1);
  assert.equal(view.showActivityForm.value, true);
  assert.ok(view.activityError.value);

  let release;
  const hanging = setup({
    visit: baseVisit(),
    activityApi: { create: () => new Promise(resolve => { release = resolve; }) },
  });
  await hanging.load();
  hanging.openCreateActivity();
  hanging.activityForm.value.title = 'T';
  const first = hanging.saveActivityForm();
  assert.equal(hanging.activitySaving.value, true);
  await hanging.saveActivityForm();
  release({ id: 'n9', activity_type: 'inspection', title: 'T', device_id: null });
  await first;
  assert.equal(hanging.activities.value.length, 1);
});

test('abrir edición precarga valores actuales; planta solo contextual', async () => {
  const view = setup({ visit: baseVisit({ service_amount: 0, scheduled_at: '2026-10-05T10:00:00.000Z' }) });
  await view.load();
  assert.equal(view.showEditForm.value, false);
  view.openEditVisit();
  assert.equal(view.showEditForm.value, true);
  assert.equal(view.editForm.value.title, 'Revisión anual');
  assert.equal(view.editForm.value.priority, 'high');
  assert.equal(view.editForm.value.service_amount, 0);
  assert.equal(view.editForm.value.currency, 'BOB');
  assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(view.editForm.value.scheduled_at));
  assert.equal(new Date(view.editForm.value.scheduled_at).getTime(), Date.parse('2026-10-05T10:00:00.000Z'));
  assert.ok(!('plant_id' in view.editForm.value));
});

test('edición: title requerido y monto negativo rechazados', async () => {
  const view = setup({ visit: baseVisit() });
  await view.load();
  view.openEditVisit();
  view.editForm.value.title = '   ';
  await view.saveEditForm();
  assert.equal(view.editError.value, 'El título es obligatorio.');
  view.editForm.value.title = 'T';
  view.editForm.value.service_amount = '-3';
  await view.saveEditForm();
  assert.equal(view.editError.value, 'El monto debe ser mayor o igual a 0.');
  assert.equal(view.showEditForm.value, true);
});

test('payload solo con campos permitidos; service_amount=0 se conserva', async () => {
  let sent = null;
  const view = setup({
    visit: baseVisit({ service_amount: 0 }),
    updateVisit: async (id, payload) => {
      sent = payload;
      return { ...baseVisit({ service_amount: 0 }), ...payload };
    },
  });
  await view.load();
  view.openEditVisit();
  await view.saveEditForm();
  assert.deepEqual(Object.keys(sent).sort(), [
    'currency', 'description', 'general_observations', 'next_maintenance_at',
    'next_maintenance_notes', 'priority', 'scheduled_at', 'service_amount',
    'technician_name', 'title',
  ]);
  assert.equal(sent.service_amount, 0);
  assert.equal(view.visit.value.title, 'Revisión anual');
});

test('limpiar campo nullable envía null y actualiza visit local', async () => {
  let sent = null;
  const view = setup({
    visit: baseVisit({ description: 'Previa', activities: [{ id: 'a1' }] }),
    updateVisit: async (id, payload) => {
      sent = payload;
      return { ...baseVisit({ description: 'Previa' }), ...payload };
    },
  });
  await view.load();
  view.openEditVisit();
  view.editForm.value.description = '   ';
  view.editForm.value.title = 'Nuevo título';
  await view.saveEditForm();
  assert.equal(sent.description, null);
  assert.equal(view.showEditForm.value, false);
  assert.equal(view.visit.value.title, 'Nuevo título');
  assert.equal(view.visit.value.description, null);
  assert.equal(view.visit.value.activities.length, 1);
});

test('edición: error conserva modal; doble submit bloqueado; client_user sin Editar', async () => {
  const userView = setup({ role: 'client_user', visit: baseVisit() });
  await userView.load();
  assert.equal(userView.canManage.value, false);

  let calls = 0;
  const view = setup({
    visit: baseVisit(),
    updateVisit: async () => {
      calls += 1;
      throw Object.assign(new Error('x'), { status: 500 });
    },
  });
  await view.load();
  view.openEditVisit();
  await view.saveEditForm();
  assert.equal(calls, 1);
  assert.equal(view.showEditForm.value, true);
  assert.ok(view.editError.value);

  let release;
  const hanging = setup({
    visit: baseVisit(),
    updateVisit: () => new Promise(resolve => { release = resolve; }),
  });
  await hanging.load();
  hanging.openEditVisit();
  const first = hanging.saveEditForm();
  assert.equal(hanging.editSaving.value, true);
  await hanging.saveEditForm();
  release({ ...baseVisit(), title: 'T2' });
  await first;
  assert.equal(hanging.showEditForm.value, false);
  assert.equal(hanging.visit.value.title, 'T2');
});

test('1-2. scheduled muestra Iniciar + Cancelar; in_progress muestra Completar + Cancelar', async () => {
  const scheduled = setup({ visit: baseVisit({ status: 'scheduled' }) });
  await scheduled.load();
  assert.deepEqual(scheduled.statusActions.value, ['in_progress', 'cancelled']);
  const inProgress = setup({ visit: baseVisit({ status: 'in_progress' }) });
  await inProgress.load();
  assert.deepEqual(inProgress.statusActions.value, ['completed', 'cancelled']);
});

test('3-4. completed y cancelled no muestran acciones de estado', async () => {
  for (const status of ['completed', 'cancelled']) {
    const view = setup({ visit: baseVisit({ status }) });
    await view.load();
    assert.deepEqual(view.statusActions.value, []);
  }
});

test('5. client_user no muestra acciones de estado', async () => {
  const view = setup({ role: 'client_user', visit: baseVisit({ status: 'scheduled' }) });
  await view.load();
  assert.deepEqual(view.statusActions.value, []);
});

test('6. iniciar pide confirmación y envía in_progress', async () => {
  let sent = null;
  const view = setup({
    visit: baseVisit({ status: 'scheduled' }),
    updateStatus: async (id, status) => {
      sent = status;
      return { ...baseVisit({ status: 'scheduled' }), status };
    },
  });
  await view.load();
  view.askTransition('in_progress');
  assert.equal(view.pendingTransition.value, 'in_progress');
  await view.applyTransition();
  assert.equal(sent, 'in_progress');
  assert.equal(view.visit.value.status, 'in_progress');
  assert.equal(view.pendingTransition.value, null);
  assert.deepEqual(view.statusActions.value, ['completed', 'cancelled']);
});

test('7-8. cancelar desde scheduled e in_progress envía cancelled', async () => {
  for (const status of ['scheduled', 'in_progress']) {
    let sent = null;
    const view = setup({
      visit: baseVisit({ status }),
      updateStatus: async (id, next) => {
        sent = next;
        return { ...baseVisit({ status }), status: next };
      },
    });
    await view.load();
    view.askTransition('cancelled');
    await view.applyTransition();
    assert.equal(sent, 'cancelled');
    assert.equal(view.visit.value.status, 'cancelled');
    assert.deepEqual(view.statusActions.value, []);
  }
});

test('9-10. completar sin activities no llama API; con activity envía completed', async () => {
  let calls = 0;
  const empty = setup({
    visit: baseVisit({ status: 'in_progress', activities: [] }),
    updateStatus: async () => { calls += 1; return {}; },
  });
  await empty.load();
  empty.askTransition('completed');
  assert.equal(empty.pendingTransition.value, null);
  assert.equal(empty.statusNotice.value, 'Debes registrar al menos una actividad antes de completar la visita.');
  assert.equal(calls, 0);

  let sent = null;
  const withActivity = setup({
    visit: baseVisit({ status: 'in_progress', activities: [{ id: 'a1' }] }),
    updateStatus: async (id, status) => {
      sent = status;
      return { ...baseVisit({ status: 'in_progress' }), status };
    },
  });
  await withActivity.load();
  withActivity.askTransition('completed');
  assert.equal(withActivity.pendingTransition.value, 'completed');
  await withActivity.applyTransition();
  assert.equal(sent, 'completed');
  assert.equal(withActivity.visit.value.status, 'completed');
});

test('11-12. transición exitosa actualiza estado y refleja completed_at del backend', async () => {
  const stamped = '2026-09-26T12:00:00.000Z';
  const view = setup({
    visit: baseVisit({ status: 'in_progress', activities: [{ id: 'a1' }] }),
    updateStatus: async () => ({ ...baseVisit({ status: 'in_progress' }), status: 'completed', completed_at: stamped }),
  });
  await view.load();
  view.askTransition('completed');
  await view.applyTransition();
  assert.equal(view.visit.value.status, 'completed');
  assert.equal(view.visit.value.completed_at, stamped);
  assert.equal(view.formatDate(stamped), new Intl.DateTimeFormat('es-BO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(stamped)));
  assert.equal(view.visit.value.activities.length, 1);
  assert.deepEqual(view.statusActions.value, []);
});

test('13. doble submit de transición bloqueado', async () => {
  let calls = 0;
  let release;
  const view = setup({
    visit: baseVisit({ status: 'scheduled' }),
    updateStatus: () => new Promise(resolve => { release = resolve; calls += 1; }),
  });
  await view.load();
  view.askTransition('cancelled');
  const first = view.applyTransition();
  assert.equal(view.transitionSaving.value, true);
  await view.applyTransition();
  release({ ...baseVisit({ status: 'scheduled' }), status: 'cancelled' });
  await first;
  assert.equal(calls, 1);
  assert.equal(view.visit.value.status, 'cancelled');
});

test('14. error API no altera estado local y mantiene confirmación', async () => {
  const view = setup({
    visit: baseVisit({ status: 'scheduled' }),
    updateStatus: async () => { throw Object.assign(new Error('x'), { status: 400 }); },
  });
  await view.load();
  view.askTransition('in_progress');
  await view.applyTransition();
  assert.equal(view.visit.value.status, 'scheduled');
  assert.equal(view.pendingTransition.value, 'in_progress');
  assert.ok(view.transitionError.value);
});
