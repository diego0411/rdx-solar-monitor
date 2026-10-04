import {
  cancelInventoryOperationDoc,
  confirmInventoryOperationDoc,
  createInventoryOperationDoc,
  getInventoryOperationDoc,
  listInventoryOperationDocs,
} from '../services/inventory.operations.service.js';
import {
  createInventoryItem,
  createInventoryProduct,
  createQuantityMovement,
  getInventoryItems,
  getInventoryMovements,
  getInventoryProduct,
  getInventoryProducts,
  patchInventoryProduct,
  transitionInventoryItem,
} from '../services/inventory.service.js';

function sendError(res, error) {
  const status = Number.isSafeInteger(error?.statusCode) ? error.statusCode : 503;
  const known = [400, 403, 404, 409].includes(status);
  return res.status(status).json({ error: known ? error.message : 'Error interno' });
}

function idempotencyKey(req) {
  const header = req.get?.('Idempotency-Key');
  if (typeof header === 'string' && header.trim() !== '') return header.trim();
  const bodyKey = req.body?.idempotency_key;
  if (typeof bodyKey === 'string' && bodyKey.trim() !== '') return bodyKey.trim();
  return null;
}

export async function listProducts(req, res) {
  try {
    return res.json(await getInventoryProducts(req.profile, req.scope, req.query));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function getProduct(req, res) {
  try {
    return res.json(await getInventoryProduct(req.profile, req.scope, req.params.id));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function postProduct(req, res) {
  try {
    return res.status(201).json(await createInventoryProduct(req.profile, req.body));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function patchProduct(req, res) {
  try {
    return res.json(await patchInventoryProduct(req.profile, req.params.id, req.body));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function listItems(req, res) {
  try {
    return res.json(await getInventoryItems(req.profile, req.scope, req.params.id, req.query));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function postItem(req, res) {
  try {
    return res.status(201).json(await createInventoryItem(req.profile, req.params.id, req.body));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function postItemTransition(req, res) {
  try {
    return res.json(await transitionInventoryItem(req.profile, req.params.id, req.body));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function postQuantityMovement(req, res) {
  try {
    return res.status(201).json(await createQuantityMovement(
      req.profile, req.params.id, req.body,
    ));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function listMovements(req, res) {
  try {
    return res.json(await getInventoryMovements(req.profile, req.scope, req.query));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function listOperations(req, res) {
  try {
    return res.json(await listInventoryOperationDocs(req.profile, req.query));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function getOperation(req, res) {
  try {
    return res.json(await getInventoryOperationDoc(req.profile, req.params.id));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function postOperation(req, res) {
  try {
    return res.status(201).json(await createInventoryOperationDoc(
      req.profile, req.body, idempotencyKey(req),
    ));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function postOperationConfirm(req, res) {
  try {
    return res.json(await confirmInventoryOperationDoc(
      req.profile, req.params.id, idempotencyKey(req),
    ));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function postOperationCancel(req, res) {
  try {
    return res.json(await cancelInventoryOperationDoc(
      req.profile, req.params.id, idempotencyKey(req),
    ));
  } catch (error) {
    return sendError(res, error);
  }
}
