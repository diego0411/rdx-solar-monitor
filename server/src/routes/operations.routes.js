import { Router } from 'express';
import {
  deleteSerial,
  getRequest,
  listAvailableItems,
  listClients,
  listProducts,
  listRequests,
  patchPreparedQuantity,
  postCancel,
  postDeliver,
  postRequest,
  postSerial,
  postTransition,
} from '../controllers/operations.controller.js';
import { requireModuleAccess, requireRoles } from '../middleware/authorization.middleware.js';

const router = Router();
router.use(requireModuleAccess('operations'));

// Procesamiento de almacén: solo rdx_admin y client_admin.
// client_user crea/lista lo propio pero no procesa (el gate de
// cancelación propia vive en el servicio).
const warehouse = requireRoles('rdx_admin', 'client_admin');

router.get('/products', listProducts);
router.get('/clients', listClients);
router.get('/requests', listRequests);
router.post('/requests', postRequest);
router.get('/requests/:id', getRequest);
router.post('/requests/:id/transition', warehouse, postTransition);
router.post('/requests/:id/lines/:lineId/serials', warehouse, postSerial);
router.delete('/requests/:id/lines/:lineId/serials/:itemId', warehouse, deleteSerial);
router.patch('/requests/:id/lines/:lineId/prepared-quantity', warehouse, patchPreparedQuantity);
router.post('/requests/:id/cancel', postCancel);
router.post('/requests/:id/deliver', warehouse, postDeliver);
router.get('/requests/:id/lines/:lineId/available-items', warehouse, listAvailableItems);

export default router;
