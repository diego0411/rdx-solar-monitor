import {
  listActiveTariffCategories,
  listEnergyDistributors,
} from '../repositories/energyCatalog.repository.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function getEnergyDistributors(req, res) {
  try {
    return res.json(await listEnergyDistributors());
  } catch {
    return res.status(503).json({ error: 'No se pudo consultar el catálogo de distribuidoras' });
  }
}

export async function getTariffCategoriesByDistributor(req, res) {
  if (!uuidPattern.test(req.params?.distributorId ?? '')) {
    return res.status(400).json({ error: 'distributorId inválido' });
  }
  try {
    return res.json(await listActiveTariffCategories(req.params.distributorId));
  } catch {
    return res.status(503).json({ error: 'No se pudieron consultar las categorías tarifarias' });
  }
}
