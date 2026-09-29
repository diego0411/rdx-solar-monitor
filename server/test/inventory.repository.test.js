import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const calls = [];
const supabase = {
  rpc(name, args) {
    calls.push({ name, args });
    return Promise.resolve({ data: [{ id: 'result' }], error: null });
  },
  from() {
    throw new Error('Los writes de stock no deben usar from()');
  },
};

mock.module('../src/config/supabase.js', { namedExports: { supabase } });
const repository = await import('../src/repositories/inventory.repository.js');

test('los tres writes de stock usan exclusivamente RPC 025', async () => {
  calls.length = 0;
  await repository.createSerializedInventoryItem({
    productId: 'p', serialNumber: 'S', notes: null, createdBy: 'u',
  });
  await repository.transitionSerializedInventoryItem({
    itemId: 'i', movementType: 'assign', clientId: 'c', plantId: 'pl',
    deviceId: null, notes: null, createdBy: 'u',
  });
  await repository.recordQuantityInventoryMovement({
    productId: 'p', movementType: 'in', quantity: '2', sourceStatus: null,
    clientId: null, plantId: null, notes: null, createdBy: 'u',
  });
  assert.deepEqual(calls.map(call => call.name), [
    'inventory_create_serialized_item',
    'inventory_transition_serialized_item',
    'inventory_record_quantity_movement',
  ]);
  assert.deepEqual(calls[0].args, {
    p_product_id: 'p', p_serial_number: 'S', p_notes: null, p_created_by: 'u',
  });
  assert.deepEqual(calls[1].args, {
    p_item_id: 'i', p_movement_type: 'assign', p_client_id: 'c', p_plant_id: 'pl',
    p_device_id: null, p_notes: null, p_created_by: 'u',
  });
  assert.deepEqual(calls[2].args, {
    p_product_id: 'p', p_movement_type: 'in', p_quantity: '2', p_source_status: null,
    p_client_id: null, p_plant_id: null, p_notes: null, p_created_by: 'u',
  });
});
