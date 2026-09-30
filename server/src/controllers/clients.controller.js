import {
  assignPlant,
  createClient,
  listClients,
  renameClient,
  setClientStatus,
} from '../services/clients.service.js';

function sendError(res, error) {
  const status = Number.isSafeInteger(error?.statusCode) ? error.statusCode : 503;
  const known = [400, 403, 404, 409].includes(status);
  return res.status(status).json({ error: known ? error.message : 'Error interno' });
}

export async function getClients(req, res) {
  const include = req.query?.include;
  const status = req.query?.status;
  if (include !== undefined && include !== 'plant_ids') {
    return res.status(400).json({ error: 'include inválido' });
  }
  if (status !== undefined && status !== 'all') {
    return res.status(400).json({ error: 'status inválido' });
  }
  try {
    return res.json(await listClients({
      includePlantIds: include === 'plant_ids',
      status: status ?? 'active',
    }));
  } catch (error) {
    if (!Number.isSafeInteger(error?.statusCode)) {
      return res.status(503).json({ error: 'No se pudieron consultar los clientes' });
    }
    return sendError(res, error);
  }
}

export async function postClient(req, res) {
  try {
    return res.status(201).json(await createClient(req.body));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function patchClient(req, res) {
  try {
    return res.json(await renameClient(req.params.id, req.body));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function patchClientStatus(req, res) {
  try {
    return res.json(await setClientStatus(req.params.id, req.body));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function putClientPlant(req, res) {
  try {
    return res.json(await assignPlant(req.params.id, req.params.plantId));
  } catch (error) {
    return sendError(res, error);
  }
}
