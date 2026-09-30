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

const contactFields = ['name', 'phone', 'email'];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clientName(value) {
  if (typeof value !== 'string') throw codedError(400, 'name inválido');
  const name = value.trim();
  if (!name || name.length > 120) throw codedError(400, 'name inválido');
  return name;
}

function clientPhone(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw codedError(400, 'phone inválido');
  const phone = value.trim();
  if (!phone) return null;
  if (phone.length > 40) throw codedError(400, 'phone inválido');
  return phone;
}

function clientEmail(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw codedError(400, 'email inválido');
  const email = value.trim();
  if (!email) return null;
  if (email.length > 254 || !emailPattern.test(email)) throw codedError(400, 'email inválido');
  return email;
}

function clientPayload(body, { requireName = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw codedError(400, 'Payload inválido');
  }
  const fields = Object.keys(body);
  for (const field of fields) {
    if (!contactFields.includes(field)) throw codedError(400, `Campo no permitido: ${field}`);
  }
  if (!fields.length) throw codedError(400, 'Payload inválido');
  if (requireName && !fields.includes('name')) throw codedError(400, 'name inválido');
  const values = {};
  if (fields.includes('name')) values.name = clientName(body.name);
  if (fields.includes('phone')) values.phone = clientPhone(body.phone);
  if (fields.includes('email')) values.email = clientEmail(body.email);
  return values;
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
  const values = clientPayload(body, { requireName: true });
  await ensureUniqueName(values.name);
  return insertClient(values);
}

export async function renameClient(id, body) {
  const clientId = validateUuid(id, 'id');
  const current = await getClientById(clientId);
  if (!current) throw codedError(404, 'Cliente no encontrado');
  const values = clientPayload(body);
  if (values.name !== undefined && values.name !== current.name) {
    await ensureUniqueName(values.name, clientId);
  } else {
    delete values.name;
  }
  for (const field of ['phone', 'email']) {
    if (values[field] !== undefined && values[field] === (current[field] ?? null)) {
      delete values[field];
    }
  }
  if (!Object.keys(values).length) return current;
  return updateClient(clientId, values);
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
