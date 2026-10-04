import { Router } from 'express';
import {
  getOperation,
  getProduct,
  listItems,
  listMovements,
  listOperations,
  listProducts,
  patchProduct,
  postItem,
  postItemTransition,
  postOperation,
  postOperationCancel,
  postOperationConfirm,
  postProduct,
  postQuantityMovement,
} from '../controllers/inventory.controller.js';
import { requireModuleAccess, requireRoles } from '../middleware/authorization.middleware.js';

const router = Router();
router.use(requireModuleAccess('inventory'));
const writer = requireRoles('rdx_admin');
// Operaciones documentales: rdx_admin o client_admin (el módulo ya lo
// exige el router y el RPC revalida rol+módulo). client_user solo lee.
const operationWriter = requireRoles('rdx_admin', 'client_admin');

router.get('/products', listProducts);
router.post('/products', writer, postProduct);
router.get('/products/:id', getProduct);
router.patch('/products/:id', writer, patchProduct);
router.get('/products/:id/items', listItems);
router.post('/products/:id/items', writer, postItem);
router.post('/products/:id/movements', writer, postQuantityMovement);
router.post('/items/:id/transition', writer, postItemTransition);
router.get('/movements', listMovements);
router.get('/operations', listOperations);
router.post('/operations', operationWriter, postOperation);
router.get('/operations/:id', getOperation);
router.post('/operations/:id/confirm', operationWriter, postOperationConfirm);
router.post('/operations/:id/cancel', operationWriter, postOperationCancel);

export default router;
