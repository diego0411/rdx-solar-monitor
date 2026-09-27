import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Contrato observable de web/src/services/api.js. Se evalúa el fuente real
// con getSession/fetch inyectados (mismo patrón que plant-economics-race):
// no se modifica arquitectura productiva para facilitar tests.
const source = readFileSync(new URL('../src/services/api.js', import.meta.url), 'utf8');
const code = source
  .replace(/^import .*;$/gm, '')
  .replace(/const API_URL = .*;/, `const API_URL = 'http://test/api';`)
  .replace(/^export async function apiFetch/m, 'async function apiFetch')
  .replace(/^export function getMyProfile/m, 'function getMyProfile');

function setup({ session = { access_token: 'token' }, handler } = {}) {
  const calls = [];
  const getSession = async () => session;
  const fetchMock = async (url, options) => {
    calls.push({ url, options });
    return handler(url, options);
  };
  const { apiFetch } = new Function('getSession', 'fetch', `${code}; return { apiFetch };`)(
    getSession, fetchMock,
  );
  return { apiFetch, calls };
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const text = (body, status, type = 'text/html') =>
  new Response(body, { status, headers: { 'Content-Type': type } });
const empty = status => new Response(null, { status });

test('1. 200 JSON devuelve el objeto', async () => {
  const { apiFetch } = setup({ handler: async () => json({ generation_kwh: 42 }) });
  assert.deepEqual(await apiFetch('/plants/p/economics'), { generation_kwh: 42 });
});

test('2. 204 devuelve null sin parsear', async () => {
  const { apiFetch } = setup({ handler: async () => new Response(null, { status: 204 }) });
  assert.equal(await apiFetch('/maintenance/v/a/1'), null);
});

test('3. 400 JSON preserva status, message, body y detail', async () => {
  const { apiFetch } = setup({ handler: async () => json({ error: 'Tarifa inválida' }, 400) });
  const failure = await apiFetch('/plants/p/energy-tariffs').catch(error => error);
  assert.equal(failure.status, 400);
  assert.equal(failure.message, 'Error de API: 400');
  assert.deepEqual(failure.body, { error: 'Tarifa inválida' });
  assert.equal(failure.detail, 'Tarifa inválida');
});

test('4. 404 JSON preserva status y body', async () => {
  const { apiFetch } = setup({ handler: async () => json({ error: 'Planta no encontrada' }, 404) });
  const failure = await apiFetch('/plants/missing/overview').catch(error => error);
  assert.equal(failure.status, 404);
  assert.equal(failure.message, 'Error de API: 404');
  assert.equal(failure.detail, 'Planta no encontrada');
});

test('5. 409 JSON preserva status y body', async () => {
  const { apiFetch } = setup({
    handler: async () => json({ error: 'Una tarifa ya vigente solo puede cerrarse' }, 409),
  });
  const failure = await apiFetch('/plants/p/energy-tariffs/t').catch(error => error);
  assert.equal(failure.status, 409);
  assert.equal(failure.body.error, 'Una tarifa ya vigente solo puede cerrarse');
  assert.equal(failure.detail, 'Una tarifa ya vigente solo puede cerrarse');
});

test('6. 429 JSON deja el mensaje del backend accesible', async () => {
  const { apiFetch } = setup({
    handler: async () => json({ error: 'Demasiadas solicitudes' }, 429),
  });
  const failure = await apiFetch('/dashboard/summary').catch(error => error);
  assert.equal(failure.status, 429);
  assert.equal(failure.message, 'Error de API: 429');
  assert.equal(failure.body.error, 'Demasiadas solicitudes');
  assert.equal(failure.detail, 'Demasiadas solicitudes');
});

test('7. 500 JSON preserva status', async () => {
  const { apiFetch } = setup({ handler: async () => json({ error: 'Error interno' }, 500) });
  const failure = await apiFetch('/plants/p/economics').catch(error => error);
  assert.equal(failure.status, 500);
  assert.equal(failure.message, 'Error de API: 500');
  assert.equal(failure.detail, 'Error interno');
});

test('8. error HTTP con HTML no produce SyntaxError y conserva status', async () => {
  const { apiFetch } = setup({
    handler: async () => text('<html><body>Bad Gateway</body></html>', 502),
  });
  const failure = await apiFetch('/plants/p/overview').catch(error => error);
  assert.equal(failure.name, 'Error');
  assert.equal(failure.status, 502);
  assert.equal(failure.message, 'Error de API: 502');
});

test('9. 200 no JSON lanza error controlado con status, no SyntaxError', async () => {
  const { apiFetch } = setup({ handler: async () => text('<html>proxy</html>', 200) });
  const failure = await apiFetch('/plants/p/overview').catch(error => error);
  assert.equal(failure.name, 'Error');
  assert.notEqual(failure.name, 'SyntaxError');
  assert.equal(failure.status, 200);
  assert.equal(failure.message, 'Error de API: 200');
});

test('10. 200 con body vacío lanza error controlado con status', async () => {
  const { apiFetch } = setup({ handler: async () => empty(200) });
  const failure = await apiFetch('/plants/p/overview').catch(error => error);
  assert.equal(failure.status, 200);
  assert.equal(failure.message, 'Error de API: 200');
});

test('11. rechazo de red se propaga intacto', async () => {
  const networkError = new TypeError('Failed to fetch');
  const { apiFetch } = setup({ handler: async () => { throw networkError; } });
  const failure = await apiFetch('/plants').catch(error => error);
  assert.equal(failure, networkError);
});

test('12. AbortError se propaga intacto (contrato Fase 4.1)', async () => {
  const abortError = new DOMException('aborted', 'AbortError');
  const { apiFetch } = setup({ handler: async () => { throw abortError; } });
  const failure = await apiFetch('/plants/p/economics').catch(error => error);
  assert.equal(failure, abortError);
  assert.equal(failure.name, 'AbortError');
});

test('13. el mismo signal llega a fetch', async () => {
  const controller = new AbortController();
  const { apiFetch, calls } = setup({ handler: async () => json({ ok: true }) });
  await apiFetch('/plants/p/economics', { signal: controller.signal });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.signal, controller.signal);
});

test('14. headers custom se conservan y Authorization usa Bearer', async () => {
  const { apiFetch, calls } = setup({
    session: { access_token: 'abc123' },
    handler: async () => json({ ok: true }),
  });
  await apiFetch('/maintenance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Test': 'yes' },
    body: JSON.stringify({ a: 1 }),
  });
  const sent = new Headers(calls[0].options.headers);
  assert.equal(sent.get('Authorization'), 'Bearer abc123');
  assert.equal(sent.get('Content-Type'), 'application/json');
  assert.equal(sent.get('X-Test'), 'yes');
  assert.equal(calls[0].options.method, 'POST');
});

test('15. sin sesión: 401 con mensaje actual y sin request', async () => {
  const { apiFetch, calls } = setup({ session: null, handler: async () => json({}) });
  const failure = await apiFetch('/plants').catch(error => error);
  assert.equal(failure.status, 401);
  assert.equal(failure.message, 'Sesión no autenticada');
  assert.equal(calls.length, 0);
});
