import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { ref, computed } from 'vue';

const viewSource = readFileSync(new URL('../src/views/AlarmsView.vue', import.meta.url), 'utf8');
const serviceSource = readFileSync(new URL('../src/services/alarms.js', import.meta.url), 'utf8');
const { descriptor } = parse(viewSource);
const code = compileScript(descriptor, { id: 'alarms-test' }).content
  .replace(/^import .*;$/gm, '').replace('export default', 'return');

const flush = () => new Promise(resolve => setImmediate(resolve));

function alarm(overrides = {}) {
  return {
    id: 'a1', provider: 'growatt', alarm_code: 'FAULT:5', title: 'PV isolation low',
    description: null, severity: 'critical', status: 'active',
    started_at: null, first_seen_at: '2026-10-06T10:00:00.000Z',
    last_seen_at: '2026-10-06T10:05:00.000Z', resolved_at: null,
    plant: { id: 'p1', name: 'Planta 1' },
    device: { id: 'd1', name: 'Inversor 1', serial_number: 'MIN1', device_type: 'MIN' },
    ...overrides,
  };
}

function setup({ alarms = [alarm()], summary = null, plants = [], detail = null, failList = false, failDetail = false } = {}) {
  const sent = { params: [], summary: 0, detail: [] };
  const total = alarms.length;
  const deps = {
    ref, computed, onMounted() {}, onUnmounted() {},
    useModalEscape: () => () => {},
    apiFetch: async () => plants,
    getPlantsCatalog: async () => plants.map(plant => ({ id: plant.id, name: plant.name ?? plant.id })),
    listAlarms: async params => {
      sent.params.push(params);
      if (failList) throw new Error('down');
      return { alarms, pagination: { page: params.page ?? 1, page_size: 10, total, total_pages: Math.max(1, Math.ceil(total / 10)) } };
    },
    getAlarmSummary: async () => {
      sent.summary += 1;
      return summary ?? { active: 0, critical: 0, warning: 0, resolved_7d: 0 };
    },
    getAlarm: async id => {
      sent.detail.push(id);
      if (failDetail) throw new Error('down');
      return detail ?? alarm({ id });
    },
  };
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps));
  return { view: component.setup({}, { expose() {} }), sent };
}

// 1/2/3. contrato de endpoints a nivel fuente
test('1/2/3: servicio usa /api/alarms y summary; sin endpoints legacy', async () => {
  assert.ok(serviceSource.includes('`/alarms${query}`'));
  assert.ok(serviceSource.includes("'/alarms/summary'"));
  assert.ok(serviceSource.includes('encodeURIComponent(id)'));
  for (const source of [serviceSource, viewSource]) {
    assert.equal(source.includes('alarms/recent'), false);
    assert.equal(source.includes('alarms/current'), false);
    assert.equal(source.includes('integrations/'), false);
  }
  const { view, sent } = setup();
  await view.load();
  assert.equal(sent.summary, 1);
  assert.equal(sent.params.length, 1);
});

// 4/5. KPIs y tabla normalizada
test('4/5: KPIs desde summary y filas normalizadas', async () => {
  const { view } = setup({
    alarms: [alarm(), alarm({ id: 'a2', status: 'resolved' })],
    summary: { active: 3, critical: 1, warning: 1, resolved_7d: 2 },
  });
  await view.load();
  assert.deepEqual({ ...view.summary.value }, { active: 3, critical: 1, warning: 1, resolved_7d: 2 });
  assert.equal(view.visibleAlarms.value.length, 2);
  assert.equal(view.visibleAlarms.value[0].title, 'PV isolation low');
});

// 6/7/8. etiquetas
test('6/7/8: etiquetas de estado y severidad', async () => {
  const { view } = setup();
  await view.load();
  assert.equal(view.statusLabel('active'), 'Activa');
  assert.equal(view.statusLabel('resolved'), 'Resuelta');
  assert.equal(view.severityLabel('critical'), 'Crítica');
  assert.equal(view.severityLabel('warning'), 'Advertencia');
  assert.equal(view.severityLabel('information'), 'Información');
  assert.equal(view.severityLabel(null), 'Sin clasificación');
  assert.equal(view.providerLabel('growatt'), 'Growatt');
  assert.equal(view.providerLabel('hyxi'), 'HYXiPOWER');
});

// 9. clasificación RDX
test('9: Growatt con severidad marca clasificación RDX', async () => {
  const { view } = setup();
  await view.load();
  assert.equal(view.isRdxClassified(alarm()), true);
  assert.equal(view.isRdxClassified(alarm({ provider: 'hyxi' })), false);
  assert.equal(view.isRdxClassified(alarm({ severity: null })), false);
});

// 10/11/12. filtros generan params y resetean página
test('10/11/12: filtros, búsqueda y reset de página', async () => {
  const { view, sent } = setup({ plants: [{ id: 'p1', name: 'Planta 1' }] });
  await view.load();
  view.statusFilter.value = 'active';
  view.severityFilter.value = 'critical';
  view.providerFilter.value = 'growatt';
  view.plantFilter.value = 'p1';
  view.search.value = 'FAULT';
  view.pagination.value.page = 3;
  view.onFilterChange();
  await flush(); await flush();
  const last = sent.params.at(-1);
  assert.deepEqual(last, { page: 1, pageSize: 10, status: 'active', severity: 'critical', provider: 'growatt', plantId: 'p1', search: 'FAULT' });
  assert.equal(view.pagination.value.page, 1);
});

// 13. paginación server-side con límites
test('13: paginación respeta total_pages', async () => {
  const many = Array.from({ length: 25 }, (_, index) => alarm({ id: `a${index}` }));
  const { view, sent } = setup({ alarms: many });
  await view.load();
  view.pagination.value = { page: 1, page_size: 10, total: 25, total_pages: 3 };
  view.goToPage(2);
  await flush(); await flush();
  assert.equal(sent.params.at(-1).page, 2);
  view.goToPage(9);
  assert.equal(view.pagination.value.page, 2);
  view.goToPage(0);
  assert.equal(view.pagination.value.page, 2);
});

// 14. estados vacíos distinguen filtros
test('14: vacío global vs vacío filtrado', async () => {
  const { view } = setup({ alarms: [] });
  await view.load();
  assert.equal(view.hasActiveFilters.value, false);
  view.search.value = 'x';
  assert.equal(view.hasActiveFilters.value, true);
});

// 15/16/17. detalle: llamada, timestamps y started_at null
test('15/16/17: detalle carga por id con timestamps', async () => {
  const { view, sent } = setup();
  await view.load();
  await view.openDetail('a9');
  assert.deepEqual(sent.detail, ['a9']);
  assert.equal(view.detail.value.id, 'a9');
  assert.equal(view.formatDate('2026-10-06T10:00:00.000Z'), new Intl.DateTimeFormat('es-BO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date('2026-10-06T10:00:00.000Z')));
  assert.equal(view.formatDate(null), 'Sin datos');
  assert.ok(viewSource.includes('No informado por el fabricante'));
  view.closeDetail();
  assert.equal(view.showDetail.value, false);
});

// 18. información técnica filtra campos útiles
test('18: technicalEntries y toggle', async () => {
  const { view } = setup();
  await view.load();
  const entries = view.technicalEntries({ faultType: 5, errorText: 'x', irrelevant: 1, empty: '', nil: null });
  assert.deepEqual(entries.map(entry => entry.field), ['faultType', 'errorText']);
  assert.equal(view.technicalOpen.value, false);
  view.toggleTechnical();
  assert.equal(view.technicalOpen.value, true);
});

// 19. raw_payload fuera de la tabla
test('19: el cuerpo de la tabla no referencia raw_payload', async () => {
  const tbody = viewSource.split('<tbody>')[1].split('</tbody>')[0];
  assert.equal(tbody.includes('raw_payload'), false);
});

// 20/21. errores recuperables sin destruir la página
test('20/21: error de lista y error de detalle aislado', async () => {
  const broken = setup({ failList: true });
  await broken.view.load();
  assert.equal(broken.view.loading.value, false);
  assert.ok(broken.view.error.value);
  const { view } = setup({ failDetail: true });
  await view.load();
  assert.equal(view.visibleAlarms.value.length, 1);
  await view.openDetail('a1');
  assert.equal(view.showDetail.value, true);
  assert.ok(view.detailError.value);
  assert.equal(view.detail.value, null);
});

// 22. HYXi se renderiza aunque no haya episodios
test('22: fila HYXi con dispositivo nulo', async () => {
  const hyxi = alarm({ id: 'h1', provider: 'hyxi', alarm_code: 'A1', title: 'Alarma HYXi', severity: null, device: null });
  const { view } = setup({ alarms: [hyxi] });
  await view.load();
  assert.equal(view.providerLabel(view.visibleAlarms.value[0].provider), 'HYXiPOWER');
  assert.equal(view.deviceName(view.visibleAlarms.value[0]), 'Sin planta');
  assert.equal(view.severityLabel(view.visibleAlarms.value[0].severity), 'Sin clasificación');
});
