import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Contrato observable de web/src/services/catalog.js. Se evalúa el fuente
// real con apiFetch/getSession/Date inyectados (mismo patrón que
// api-fetch.test.js): sin llamadas reales ni dependencias nuevas.
const source = readFileSync(new URL('../src/services/catalog.js', import.meta.url), 'utf8');
const code = source
  .replace(/^import .*;$/gm, '')
  .replace(/^export const PLANTS_CATALOG_TTL_MS/m, 'const PLANTS_CATALOG_TTL_MS')
  .replace(/^export async function getPlantsCatalog/m, 'async function getPlantsCatalog')
  .replace(/^export function invalidatePlantsCatalog/m, 'function invalidatePlantsCatalog')
  .replace(/^export const DEVICES_CATALOG_TTL_MS/m, 'const DEVICES_CATALOG_TTL_MS')
  .replace(/^export async function getDevicesCatalog/m, 'async function getDevicesCatalog')
  .replace(/^export function invalidateDevicesCatalog/m, 'function invalidateDevicesCatalog');

const TTL = 10 * 60 * 1000;

function setup({ userId = 'u1', rows = [{ id: 'p1', name: 'Planta 1' }], fail = null, now = 1_000_000 } = {}) {
  const calls = [];
  let currentNow = now;
  let currentUser = userId;
  let currentRows = rows;
  let failure = fail;
  const apiFetch = async path => {
    calls.push(path);
    if (failure) throw failure;
    return currentRows;
  };
  const getSession = async () => (currentUser ? { user: { id: currentUser } } : null);
  const FakeDate = { now: () => currentNow };
  const { getPlantsCatalog, invalidatePlantsCatalog, getDevicesCatalog, invalidateDevicesCatalog } = new Function(
    'apiFetch', 'getSession', 'Date', `${code}; return { getPlantsCatalog, invalidatePlantsCatalog, getDevicesCatalog, invalidateDevicesCatalog };`,
  )(apiFetch, getSession, FakeDate);
  return {
    calls,
    getPlantsCatalog,
    invalidatePlantsCatalog,
    getDevicesCatalog,
    invalidateDevicesCatalog,
    setUser: id => { currentUser = id; },
    setRows: next => { currentRows = next; },
    setFail: error => { failure = error; },
    advance: ms => { currentNow += ms; },
  };
}

// 1. primera vista descarga una vez; segunda dentro del TTL reutiliza sin GET
test('1: primera llamada descarga; segunda dentro del TTL no repite GET', async () => {
  const h = setup();
  const first = await h.getPlantsCatalog({});
  assert.deepEqual(first, [{ id: 'p1', name: 'Planta 1' }]);
  const second = await h.getPlantsCatalog({});
  assert.deepEqual(second, [{ id: 'p1', name: 'Planta 1' }]);
  assert.deepEqual(h.calls, ['/plants']);
});

// 2. solo viaja {id,name}: telemetría y extras se recortan
test('2: proyección {id,name} con fallback de nombre y sin extras', async () => {
  const h = setup({ rows: [
    { id: 'p1', name: 'Planta 1', status: 'online', capacity_kwp: 10, raw_data: { x: 1 }, metadata: {} },
    { id: 'p2', name: null },
  ] });
  const data = await h.getPlantsCatalog({});
  assert.deepEqual(data, [{ id: 'p1', name: 'Planta 1' }, { id: 'p2', name: 'p2' }]);
});

// 3. TTL vencido provoca nueva descarga
test('3: TTL vencido descarga de nuevo', async () => {
  const h = setup();
  await h.getPlantsCatalog({});
  h.advance(TTL + 1);
  await h.getPlantsCatalog({});
  assert.deepEqual(h.calls, ['/plants', '/plants']);
});

// 4. peticiones concurrentes comparten una sola descarga
test('4: concurrentes comparten un solo GET', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const h = setup({ rows: gate.then(() => [{ id: 'p1', name: 'P1' }]) });
  const pending = [h.getPlantsCatalog({}), h.getPlantsCatalog({}), h.getPlantsCatalog({})];
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.length, 1);
  release();
  const results = await Promise.all(pending);
  assert.equal(h.calls.length, 1);
  for (const result of results) assert.deepEqual(result, [{ id: 'p1', name: 'P1' }]);
});

// 5. error no se cachea: propaga y reintenta después
test('5: error propaga sin caché permanente y reintenta', async () => {
  const h = setup({ fail: new Error('down') });
  await assert.rejects(h.getPlantsCatalog({}), /down/);
  h.setFail(null);
  const data = await h.getPlantsCatalog({});
  assert.deepEqual(data, [{ id: 'p1', name: 'Planta 1' }]);
  assert.deepEqual(h.calls, ['/plants', '/plants']);
});

// 6. cambio de usuario invalida: sin reutilización entre identidades
test('6: cambio de usuario descarga de nuevo', async () => {
  const h = setup({ userId: 'u1' });
  await h.getPlantsCatalog({});
  h.setUser('u2');
  await h.getPlantsCatalog({});
  assert.deepEqual(h.calls, ['/plants', '/plants']);
});

// 7. invalidatePlantsCatalog fuerza descarga
test('7: invalidación fuerza descarga', async () => {
  const h = setup();
  await h.getPlantsCatalog({});
  h.invalidatePlantsCatalog();
  await h.getPlantsCatalog({});
  assert.deepEqual(h.calls, ['/plants', '/plants']);
});

// 8. cancelación del llamante no interrumpe la descarga compartida
test('8: abort del llamante rechaza su espera sin cancelar la compartida', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const h = setup({ rows: gate.then(() => [{ id: 'p1', name: 'P1' }]) });
  const controller = new AbortController();
  const waiting = h.getPlantsCatalog({ signal: controller.signal });
  const waiter = waiting.then(() => 'ok', error => error?.name ?? String(error));
  controller.abort();
  assert.equal(await waiter, 'AbortError');
  release();
  const data = await h.getPlantsCatalog({});
  assert.deepEqual(data, [{ id: 'p1', name: 'P1' }]);
  assert.equal(h.calls.length, 1);
});

// 10. respuesta tardía tras invalidación no repuebla el caché nuevo
test('10: invalidate durante vuelo descarta la respuesta antigua', async () => {
  let releaseOld;
  const gate = new Promise(resolve => { releaseOld = resolve; });
  const h = setup({ rows: gate.then(() => [{ id: 'old', name: 'Vieja' }]) });
  const stale = h.getPlantsCatalog({});
  await new Promise(resolve => setImmediate(resolve));
  h.invalidatePlantsCatalog();
  h.setRows([{ id: 'p1', name: 'Planta 1' }]);
  const fresh = h.getPlantsCatalog({});
  releaseOld();
  assert.deepEqual(await stale, [{ id: 'old', name: 'Vieja' }]);
  assert.deepEqual(await fresh, [{ id: 'p1', name: 'Planta 1' }]);
  assert.deepEqual(await h.getPlantsCatalog({}), [{ id: 'p1', name: 'Planta 1' }]);
  assert.equal(h.calls.length, 2);
});

// 11. respuesta tardía tras cambio de usuario no contamina la identidad nueva
test('11: cambio de usuario durante vuelo descarta la respuesta anterior', async () => {
  let releaseOld;
  const gate = new Promise(resolve => { releaseOld = resolve; });
  const h = setup({ userId: 'u1', rows: gate.then(() => [{ id: 'old', name: 'Vieja' }]) });
  const stale = h.getPlantsCatalog({});
  await new Promise(resolve => setImmediate(resolve));
  h.setUser('u2');
  h.setRows([{ id: 'p1', name: 'Planta 1' }]);
  const fresh = h.getPlantsCatalog({});
  releaseOld();
  assert.deepEqual(await stale, [{ id: 'old', name: 'Vieja' }]);
  assert.deepEqual(await fresh, [{ id: 'p1', name: 'Planta 1' }]);
  assert.deepEqual(await h.getPlantsCatalog({}), [{ id: 'p1', name: 'Planta 1' }]);
  assert.equal(h.calls.length, 2);
});

// D1. catálogo de dispositivos: proyección {id,plant_id,name,serial_number}
test('D1: devices proyecta identidad sin telemetría ni extras', async () => {
  const h = setup({ rows: [
    { id: 'd1', plant_id: 'p1', name: 'Inv 1', serial_number: 'SN1', status: 'online', metadata: {}, raw_data: {} },
    { id: 'd2', plant_id: null, name: null, serial_number: 'SN2' },
    { id: 'd3', plant_id: 'p1', name: null, serial_number: null },
  ] });
  const data = await h.getDevicesCatalog({});
  assert.deepEqual(data, [
    { id: 'd1', plant_id: 'p1', name: 'Inv 1', serial_number: 'SN1' },
    { id: 'd2', plant_id: null, name: 'SN2', serial_number: 'SN2' },
    { id: 'd3', plant_id: 'p1', name: 'd3', serial_number: null },
  ]);
  assert.deepEqual(h.calls, ['/devices/catalog']);
});

// D2. TTL propio de 5 minutos y single-flight
test('D2: devices TTL 5 min y una sola descarga concurrente', async () => {
  const h = setup({ rows: [{ id: 'd1', plant_id: 'p1', name: 'A', serial_number: 'S' }] });
  await Promise.all([h.getDevicesCatalog({}), h.getDevicesCatalog({})]);
  assert.deepEqual(h.calls, ['/devices/catalog']);
  h.advance(5 * 60 * 1000 - 1);
  await h.getDevicesCatalog({});
  assert.equal(h.calls.length, 1);
  h.advance(2);
  await h.getDevicesCatalog({});
  assert.deepEqual(h.calls, ['/devices/catalog', '/devices/catalog']);
});

// D3. respuesta tardía tras invalidación no repuebla
test('D3: invalidate devices en vuelo descarta la respuesta antigua', async () => {
  let releaseOld;
  const gate = new Promise(resolve => { releaseOld = resolve; });
  const h = setup({ rows: gate.then(() => [{ id: 'old' }]) });
  const stale = h.getDevicesCatalog({});
  await new Promise(resolve => setImmediate(resolve));
  h.invalidateDevicesCatalog();
  h.setRows([{ id: 'd1', plant_id: 'p1', name: 'A', serial_number: 'S' }]);
  const fresh = h.getDevicesCatalog({});
  releaseOld();
  assert.deepEqual(await stale, [{ id: 'old', plant_id: null, name: 'old', serial_number: null }]);
  assert.deepEqual(await fresh, [{ id: 'd1', plant_id: 'p1', name: 'A', serial_number: 'S' }]);
  assert.deepEqual(await h.getDevicesCatalog({}), [{ id: 'd1', plant_id: 'p1', name: 'A', serial_number: 'S' }]);
  assert.equal(h.calls.length, 2);
});

// D4. cachés independientes: plantas y dispositivos no se interfieren
test('D4: invalidar plantas no toca dispositivos; usuario nuevo refetch ambos', async () => {
  const h = setup({ rows: [{ id: 'x', name: 'X' }] });
  await h.getPlantsCatalog({});
  await h.getDevicesCatalog({});
  assert.deepEqual(h.calls, ['/plants', '/devices/catalog']);
  h.invalidatePlantsCatalog();
  await h.getDevicesCatalog({});
  assert.deepEqual(h.calls, ['/plants', '/devices/catalog']);
  await h.getPlantsCatalog({});
  assert.deepEqual(h.calls, ['/plants', '/devices/catalog', '/plants']);
  h.setUser('u2');
  await h.getPlantsCatalog({});
  await h.getDevicesCatalog({});
  assert.deepEqual(h.calls, ['/plants', '/devices/catalog', '/plants', '/plants', '/devices/catalog']);
});

// 9. copias independientes: mutar el resultado no contamina el caché
test('9: resultados son copias; mutaciones no afectan a otros', async () => {
  const h = setup();
  const first = await h.getPlantsCatalog({});
  first[0].name = 'MUTADO';
  first.push({ id: 'x', name: 'X' });
  const second = await h.getPlantsCatalog({});
  assert.deepEqual(second, [{ id: 'p1', name: 'Planta 1' }]);
  assert.deepEqual(h.calls, ['/plants']);
});
