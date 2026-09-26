import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import express from 'express';

mock.module('../src/config/supabase.js', {
  namedExports: {
    supabase: {
      auth: {
        getUser: async token => (
          token === 'admin-token'
            ? { data: { user: { id: 'admin-1' } }, error: null }
            : { data: { user: null }, error: new Error('invalid token') }
        ),
      },
      from(table) {
        if (table === 'user_profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'admin-1',
                    client_id: null,
                    role: 'rdx_admin',
                    display_name: 'Admin',
                    active: true,
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        return { select: async () => ({ error: null }) };
      },
    },
  },
});

const { default: healthRoutes } = await import('../src/routes/health.routes.js');

async function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/health', healthRoutes);
  const server = await new Promise(resolve => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started));
  });
  return { server, base: `http://127.0.0.1:${server.address().port}/api/health` };
}

test('GET /api/health público responde mínimo { status: ok }', async t => {
  const { server, base } = await startApp();
  t.after(() => server.close());
  const res = await fetch(base);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('GET /api/health/database sin auth responde 401 sin detalles', async t => {
  const { server, base } = await startApp();
  t.after(() => server.close());
  const res = await fetch(`${base}/database`);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.ok(!('tables' in body));
});

test('GET /api/health/database con rdx_admin no expone tablas', async t => {
  const { server, base } = await startApp();
  t.after(() => server.close());
  const res = await fetch(`${base}/database`, {
    headers: { authorization: 'Bearer admin-token' },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { status: 'ok', database: 'connected' });
  assert.ok(!('tables' in body));
});
