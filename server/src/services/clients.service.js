import { listActiveClients } from '../repositories/clients.repository.js';

export async function listClients() {
  return listActiveClients();
}
