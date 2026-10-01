import { listUsers, createUser, updateUser, setUserStatus } from '../services/users.service.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sendError(res, error) {
  const status = Number.isSafeInteger(error?.statusCode) ? error.statusCode : 503;
  const known = [400, 403, 404, 409].includes(status);
  return res.status(status).json({ error: known ? error.message : 'Error interno' });
}

export async function getUsers(req, res) {
  try {
    return res.json(await listUsers(req.profile));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function postUsers(req, res) {
  try {
    return res.status(201).json(await createUser(req.profile, req.body));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function patchUser(req, res) {
  if (!uuidPattern.test(req.params.id ?? '')) {
    return res.status(400).json({ error: 'id inválido' });
  }
  try {
    return res.json(await updateUser(req.profile, req.params.id, req.body));
  } catch (error) {
    return sendError(res, error);
  }
}

export async function patchUserStatus(req, res) {
  if (!uuidPattern.test(req.params.id ?? '')) {
    return res.status(400).json({ error: 'id inválido' });
  }
  try {
    return res.json(await setUserStatus(req.profile, req.params.id, req.body?.active));
  } catch (error) {
    return sendError(res, error);
  }
}
