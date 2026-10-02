import {
  cancelMaterialRequest,
  createMaterialRequest,
  deliverMaterialRequest,
  getMaterialRequestDetail,
  listAvailableProducts,
  listAvailableSerials,
  listMaterialRequests,
  prepareSerializedItem,
  releaseSerializedItem,
  setPreparedQuantity,
  transitionMaterialRequest,
} from '../services/operations.service.js';

function sendError(res, error) {
  const status = Number.isSafeInteger(error?.statusCode) ? error.statusCode : 503;
  const known = [400, 403, 404, 409].includes(status);
  if (!known) {
    // Errores inesperados: mensaje genérico al cliente, detalle al log.
    console.error('[operations]', error);
  }
  return res.status(status).json({ error: known ? error.message : 'Error interno' });
}

function idempotencyKey(req) {
  const header = req.get?.('Idempotency-Key');
  if (typeof header === 'string' && header.trim() !== '') return header.trim();
  const bodyKey = req.body?.idempotency_key;
  if (typeof bodyKey === 'string' && bodyKey.trim() !== '') return bodyKey.trim();
  return null;
}

export async function listRequests(req, res) {
  try {
    return res.json(await listMaterialRequests(req.profile, req.query));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function getRequest(req, res) {
  try {
    return res.json(await getMaterialRequestDetail(req.profile, req.params.id));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function postRequest(req, res) {
  try {
    return res.status(201).json(await createMaterialRequest(req.profile, req.body));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function postTransition(req, res) {
  try {
    return res.json(await transitionMaterialRequest(
      req.profile, req.params.id, req.body, idempotencyKey(req),
    ));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function postSerial(req, res) {
  try {
    return res.status(201).json(await prepareSerializedItem(
      req.profile, req.params.id, req.params.lineId, req.body,
    ));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function deleteSerial(req, res) {
  try {
    return res.json(await releaseSerializedItem(
      req.profile, req.params.id, req.params.lineId, req.params.itemId, req.body,
    ));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function patchPreparedQuantity(req, res) {
  try {
    return res.json(await setPreparedQuantity(
      req.profile, req.params.id, req.params.lineId, req.body,
    ));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function postCancel(req, res) {
  try {
    return res.json(await cancelMaterialRequest(
      req.profile, req.params.id, idempotencyKey(req),
    ));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function postDeliver(req, res) {
  try {
    return res.json(await deliverMaterialRequest(
      req.profile, req.params.id, req.body, idempotencyKey(req),
    ));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function listProducts(req, res) {
  try {
    return res.json(await listAvailableProducts(req.profile));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function listAvailableItems(req, res) {
  try {
    return res.json(await listAvailableSerials(
      req.profile, req.params.id, req.params.lineId,
    ));
  } catch (error) {
    return sendError(res, error);
  }
}
