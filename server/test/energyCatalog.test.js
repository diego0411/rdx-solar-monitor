import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

const CRE_ID = '11111111-1111-1111-8111-111111111111';

let categoriesResult = [];
let categoriesError = null;
let categoriesCalls = [];

mock.module('../src/repositories/energyCatalog.repository.js', {
  namedExports: {
    listEnergyDistributors: async () => [
      { id: CRE_ID, code: 'CRE', name: 'CRE R.L.' },
      { id: '22222222-2222-2222-8222-222222222222', code: 'DELAPAZ', name: 'DELAPAZ' },
    ],
    listActiveTariffCategories: async distributorId => {
      categoriesCalls.push(distributorId);
      if (categoriesError) throw categoriesError;
      return categoriesResult;
    },
  },
});

const {
  getEnergyDistributors,
  getTariffCategoriesByDistributor,
} = await import('../src/controllers/energyCatalog.controller.js');

function context(params = {}) {
  const response = { statusCode: 200, body: null };
  const res = {
    status(code) { response.statusCode = code; return res; },
    json(payload) { response.body = payload; return res; },
  };
  return { req: { params }, res, response };
}

test('GET distribuidoras retorna el catálogo activo', async () => {
  const { req, res, response } = context();
  await getEnergyDistributors(req, res);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.map(entry => entry.name), ['CRE R.L.', 'DELAPAZ']);
});

test('GET categorías por distribuidor retorna solo sus categorías activas', async () => {
  categoriesCalls = [];
  categoriesError = null;
  categoriesResult = [{ id: 'a', code: 'D-PD-BT', name: 'Domiciliaria / Pequeña Demanda / Baja Tensión' }];
  const { req, res, response } = context({ distributorId: CRE_ID });
  await getTariffCategoriesByDistributor(req, res);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(categoriesCalls, [CRE_ID]);
  assert.equal(response.body[0].code, 'D-PD-BT');
});

test('distributorId inválido responde 400 sin consultar el repositorio', async () => {
  categoriesCalls = [];
  const { req, res, response } = context({ distributorId: 'no-uuid' });
  await getTariffCategoriesByDistributor(req, res);
  assert.equal(response.statusCode, 400);
  assert.deepEqual(categoriesCalls, []);
});

test('fallo del repositorio responde 503', async () => {
  categoriesError = new Error('db caída');
  const { req, res, response } = context({ distributorId: CRE_ID });
  await getTariffCategoriesByDistributor(req, res);
  assert.equal(response.statusCode, 503);
  categoriesError = null;
});
