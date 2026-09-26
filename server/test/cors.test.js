import assert from 'node:assert/strict';
import test from 'node:test';

import {
  corsOptions,
  isOriginAllowed,
  parseAllowedOrigins,
} from '../src/config/cors.js';

const PORTAL = 'https://portal.rdxtechnology.com';

test('parsea CORS_ORIGINS con trim e ignora entradas vacías', () => {
  assert.deepEqual(
    parseAllowedOrigins(` ${PORTAL} ,, https://otro.com ,`),
    [PORTAL, 'https://otro.com'],
  );
  assert.deepEqual(parseAllowedOrigins(undefined), []);
  assert.deepEqual(parseAllowedOrigins(''), []);
});

test('origen permitido responde true en producción', () => {
  assert.equal(
    isOriginAllowed(PORTAL, { allowedOrigins: PORTAL, nodeEnv: 'production' }),
    true,
  );
});

test('origen no listado responde false en producción', () => {
  assert.equal(
    isOriginAllowed('https://evil.example', { allowedOrigins: PORTAL, nodeEnv: 'production' }),
    false,
  );
  assert.equal(
    isOriginAllowed(PORTAL, { allowedOrigins: '', nodeEnv: 'production' }),
    false,
  );
});

test('request sin Origin siempre se permite', () => {
  assert.equal(isOriginAllowed(undefined, { allowedOrigins: '', nodeEnv: 'production' }), true);
  assert.equal(isOriginAllowed('', { allowedOrigins: '', nodeEnv: 'production' }), true);
});

test('desarrollo permite localhost local sin estar en la lista', () => {
  const options = { allowedOrigins: '', nodeEnv: 'development' };
  assert.equal(isOriginAllowed('http://localhost:5173', options), true);
  assert.equal(isOriginAllowed('http://127.0.0.1:5173', options), true);
  assert.equal(isOriginAllowed('https://evil.example', options), false);
});

test('comparación de origen es exacta', () => {
  const options = { allowedOrigins: PORTAL, nodeEnv: 'production' };
  assert.equal(isOriginAllowed(`${PORTAL}.evil.com`, options), false);
  assert.equal(isOriginAllowed(`${PORTAL}/extra`, options), false);
});

test('corsOptions delega en isOriginAllowed sin error', async () => {
  const result = await new Promise((resolve, reject) => {
    process.env.CORS_ORIGINS = PORTAL;
    corsOptions.origin(PORTAL, (error, allowed) => (error ? reject(error) : resolve(allowed)));
    delete process.env.CORS_ORIGINS;
  });
  assert.equal(result, true);
});
