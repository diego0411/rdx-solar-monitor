import test, { beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createClient } from '@supabase/supabase-js';

// Exercise the real router, middleware, repositories and Supabase SDK against
// an isolated transport. No credentials, accounts or database in production.
const actors = {
  admin: { id: 'admin', role: 'rdx_admin', client_id: null, active: true },
  manager: { id: 'manager', role: 'client_admin', client_id: 'nexora', active: true },
  reader: { id: 'reader', role: 'client_user', client_id: 'nexora', active: true },
};
const PASSWORD = 'Test-only-Password-42!';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const testToken = [
  { alg: 'HS256', typ: 'JWT' },
  { sub: USER_ID, exp: Math.floor(Date.now() / 1000) + 3600 },
].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.dGVzdA';
let state;
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'X-Supabase-Api-Version': '2024-01-01' },
});

async function transport(input, options = {}) {
  const url = new URL(input);
  const method = options.method ?? 'GET';
  const body = options.body ? JSON.parse(options.body) : null;
  if (url.pathname === '/auth/v1/user') {
    const actor = new Headers(options.headers).get('authorization')?.replace('Bearer ', '');
    return actors[actor] ? json({ id: actor }) : json({ message: 'Unauthorized' }, 401);
  }
  if (url.pathname === '/auth/v1/admin/users' && method === 'POST') {
    state.authPayload = body;
    if (state.authError) return json(state.authError, state.authStatus);
    if (state.authUsers.some(user => user.email === body.email)) {
      return json({ code: 'email_exists', msg: 'Already registered' }, 422);
    }
    const user = { id: USER_ID, email: body.email, user_metadata: body.user_metadata };
    state.authUsers.push(user);
    state.authPasswords.set(user.id, body.password);
    return json(user);
  }
  if (url.pathname === '/auth/v1/admin/users' && method === 'GET') {
    return json({ users: state.authUsers, aud: 'authenticated' });
  }
  if (url.pathname === `/auth/v1/admin/users/${USER_ID}` && method === 'DELETE') {
    state.deletions++;
    if (state.cleanupFails) return json({ msg: PASSWORD }, 500);
    state.authUsers = [];
    state.authPasswords.clear();
    return json({});
  }
  if (url.pathname === '/auth/v1/token') {
    state.loginPayload = body;
    const user = state.authUsers.find(user => user.email === body.email);
    if (!user || state.authPasswords.get(user.id) !== body.password) {
      return json({ code: 'invalid_credentials', msg: 'Invalid credentials' }, 400);
    }
    return json({ user, access_token: testToken, refresh_token: 'test-refresh',
      token_type: 'bearer', expires_in: 3600 });
  }
  if (url.pathname === '/rest/v1/clients') {
    return json(url.searchParams.has('id') ? { id: 'nexora' } : [{ id: 'nexora', name: 'Nexora' }]);
  }
  if (url.pathname === '/rest/v1/client_plants') return json([]);
  if (url.pathname === '/rest/v1/user_profiles') {
    if (method === 'POST') {
      state.profilePayload = body;
      if (state.profileFails) return json({ message: PASSWORD }, 500);
      const profile = { ...body, created_at: '2026-01-01T00:00:00Z' };
      state.profiles.push(profile);
      return json(profile);
    }
    const id = url.searchParams.get('id')?.replace('eq.', '');
    return json(id ? actors[id] : state.profiles);
  }
  throw new Error('Unexpected test transport request');
}

const supabase = createClient('https://supabase.invalid', 'test-service-role', {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport },
});
mock.module('../src/config/supabase.js', { exports: { supabase } });
const { default: usersRoutes } = await import('../src/routes/users.routes.js');
const app = express();
app.use(express.json());
app.use('/api/users', usersRoutes);
// Let Node emit its module-mocking warnings before application log assertions.
await new Promise(resolve => setImmediate(resolve));

beforeEach(() => {
  state = { authUsers: [], authPasswords: new Map(), profiles: [], deletions: 0, authStatus: 422 };
});

async function request(t, actor, body, method = 'POST') {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/users`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(actor ? { Authorization: `Bearer ${actor}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

const payload = (overrides = {}) => ({
  name: ' Nuevo usuario ', email: 'new@example.test', role: 'client_user', password: PASSWORD, ...overrides,
});

test('create -> Auth password sign-in contract -> visible user; secrets stay out of profiles and responses', async t => {
  const logs = mock.method(console, 'error', () => {});
  t.after(() => logs.mock.restore());
  const result = await request(t, 'admin', payload());
  assert.equal(result.status, 201);
  assert.equal(state.authPayload.password === PASSWORD, true);
  assert.equal(state.authPayload.email_confirm, true);
  assert.deepEqual(state.authPayload.user_metadata, { display_name: 'Nuevo usuario' });
  assert.equal(result.body.id, state.profilePayload.id);
  assert.equal(result.body.client_id, 'nexora');
  assert.equal(state.profilePayload.active, true);
  for (const value of [state.profilePayload, result.body]) {
    assert.equal(JSON.stringify(value).includes(PASSWORD), false);
    assert.equal(Object.keys(value).some(key => /password/i.test(key)), false);
  }
  assert.equal(logs.mock.callCount(), 0);
  const login = await supabase.auth.signInWithPassword({ email: result.body.email, password: PASSWORD });
  assert.equal(login.error, null);
  assert.equal(login.data.user.id, result.body.id);
  const listed = await request(t, 'admin', null, 'GET');
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body, [result.body]);
  assert.equal(logs.mock.calls.some(call => call.arguments.some(value => String(value).includes(PASSWORD))), false);
});

for (const role of ['client_admin', 'client_user']) {
  test(`client_admin creates ${role} only in Nexora`, async t => {
    const result = await request(t, 'manager', payload({ role, client_id: 'other' }));
    assert.equal(result.status, 201);
    assert.equal(result.body.role, role);
    assert.equal(result.body.client_id, 'nexora');
  });
}

test('client_user gets 403 for listing and creating; unauthenticated gets 401', async t => {
  assert.equal((await request(t, 'reader', payload())).status, 403);
  assert.equal((await request(t, 'reader', null, 'GET')).status, 403);
  assert.equal((await request(t, null, payload())).status, 401);
  assert.equal(state.authPayload, undefined);
});

test('neither administrator can create rdx_admin', async t => {
  for (const actor of ['admin', 'manager']) {
    assert.equal((await request(t, actor, payload({ role: 'rdx_admin' }))).status, 403);
  }
  assert.equal(state.authPayload, undefined);
});

test('reject invalid or missing passwords before calling Auth', async t => {
  for (const password of [undefined, null, 123456, '', 'short', '      ']) {
    assert.equal((await request(t, 'admin', payload({ password }))).status, 400);
  }
  assert.equal(state.authPayload, undefined);
});

test('keep password whitespace unchanged and support existing display_name callers', async t => {
  const password = ` ${PASSWORD} `;
  assert.equal((await request(t, 'admin', payload({ name: undefined, display_name: 'Legacy', password }))).status, 201);
  assert.equal(state.authPayload.password === password, true);
  assert.equal(state.profilePayload.display_name, 'Legacy');
});

test('duplicate email is 409 and does not create another profile', async t => {
  await request(t, 'admin', payload());
  assert.equal((await request(t, 'admin', payload())).status, 409);
  assert.equal(state.profiles.length, 1);
});

test('Supabase weak password rejection is 400, never mistaken for duplicate email or echoed', async t => {
  state.authError = { code: 'weak_password', msg: PASSWORD, weak_password: { reasons: ['length'] } };
  const result = await request(t, 'admin', payload());
  assert.equal(result.status, 400);
  assert.equal(JSON.stringify(result.body).includes(PASSWORD), false);
  assert.equal(state.profilePayload, undefined);
});

test('unknown Supabase errors are sanitized, including non-duplicate 422', async t => {
  state.authError = { code: 'unexpected_failure', msg: PASSWORD };
  const result = await request(t, 'admin', payload());
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { error: 'Error interno' });
});

test('profile failure rolls back Auth user without leaking provider details', async t => {
  state.profileFails = true;
  const result = await request(t, 'admin', payload());
  assert.equal(result.status, 503);
  assert.equal(state.deletions, 1);
  assert.equal(state.authUsers.length, 0);
  assert.equal(state.profiles.length, 0);
  assert.deepEqual(result.body, { error: 'Error interno' });
});

test('rollback failure is reported safely and never returns success or password', async t => {
  const logs = mock.method(console, 'error', () => {});
  t.after(() => logs.mock.restore());
  state.profileFails = true;
  state.cleanupFails = true;
  const result = await request(t, 'admin', payload());
  assert.equal(result.status, 503);
  assert.equal(logs.mock.callCount(), 1);
  assert.equal(JSON.stringify(logs.mock.calls.map(call => call.arguments)).includes(PASSWORD), false);
  assert.equal(state.profiles.length, 0);
});
