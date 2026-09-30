import {
  getClientById,
  insertClient,
  listActiveClients,
  listAllClients,
  listClientPlantAssignments,
  updateClient,
} from '../repositories/clients.repository.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function codedError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateUuid(value, field) {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw codedError(400, `${field} inválido`);
  }
  return value.toLowerCase();
}

function clientName(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw codedError(400, 'Payload inválido');
  }
  for (const field of Object.keys(body)) {
    if (field !== 'name') throw codedError(400, `Campo no permitido: ${field}`);
  }
  if (typeof body.name !== 'string') throw codedError(400, 'name inválido');
  const name = body.name.trim();
  if (!name || name.length > 120) throw codedError(400, 'name inválido');
  return name;
}

async function ensureUniqueName(name, excludedId = null) {
  const normalized = name.toLocaleLowerCase();
  const duplicate = (await listAllClients()).some(client =>
    client.id !== excludedId && client.name.trim().toLocaleLowerCase() === normalized);
  if (duplicate) throw codedError(409, 'Ya existe un cliente con ese nombre');
}

function withPlantIds(clients, assignments) {
  const plantIdsByClient = new Map(clients.map(client => [client.id, []]));
  for (const assignment of assignments) {
    plantIdsByClient.get(assignment.client_id)?.push(assignment.plant_id);
  }
  return clients.map(client => ({ ...client, plant_ids: plantIdsByClient.get(client.id) }));
}

export async function listClients({ includePlantIds = false, status = 'active' } = {}) {
  const clients = status === 'all' ? await listAllClients() : await listActiveClients();
  if (!includePlantIds) return clients;
  return withPlantIds(clients, await listClientPlantAssignments());
}

export async function createClient(body) {
  const name = clientName(body);
  await ensureUniqueName(name);
  return insertClient(name);
}

export async function renameClient(id, body) {
  const clientId = validateUuid(id, 'id');
  const current = await getClientById(clientId);
  if (!current) throw codedError(404, 'Cliente no encontrado');
  const name = clientName(body);
  if (name === current.name) return current;
  await ensureUniqueName(name, clientId);
  return updateClient(clientId, { name });
}

export async function setClientStatus(id, body) {
  const clientId = validateUuid(id, 'id');
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).length !== 1 || typeof body.active !== 'boolean') {
    throw codedError(400, 'active debe ser true o false');
  }
  const current = await getClientById(clientId);
  if (!current) throw codedError(404, 'Cliente no encontrado');
  if (current.active === body.active) return current;
  return updateClient(clientId, { active: body.active });
}
