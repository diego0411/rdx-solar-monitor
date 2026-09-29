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
