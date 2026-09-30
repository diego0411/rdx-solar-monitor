import { listClients } from '../services/clients.service.js';

export async function getClients(req, res) {
  const include = req.query?.include;
  if (include !== undefined && include !== 'plant_ids') {
    return res.status(400).json({ error: 'include inválido' });
  }
  try {
    return res.json(await listClients({ includePlantIds: include === 'plant_ids' }));
  } catch {
    return res.status(503).json({ error: 'No se pudieron consultar los clientes' });
  }
}
