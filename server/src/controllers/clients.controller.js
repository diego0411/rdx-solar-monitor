import { listClients } from '../services/clients.service.js';

export async function getClients(req, res) {
  try {
    return res.json(await listClients());
  } catch {
    return res.status(503).json({ error: 'No se pudieron consultar los clientes' });
  }
}
