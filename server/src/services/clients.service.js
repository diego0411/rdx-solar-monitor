import {
  listActiveClients,
  listClientPlantAssignments,
} from '../repositories/clients.repository.js';

export async function listClients({ includePlantIds = false } = {}) {
  const clients = await listActiveClients();
  if (!includePlantIds) return clients;

  const plantIdsByClient = new Map(clients.map(client => [client.id, []]));
  const assignments = await listClientPlantAssignments();
  for (const assignment of assignments) {
    plantIdsByClient.get(assignment.client_id)?.push(assignment.plant_id);
  }

  return clients.map(client => ({
    ...client,
    plant_ids: plantIdsByClient.get(client.id),
  }));
}
