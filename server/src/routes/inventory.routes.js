import { Router } from 'express';
import {
  getProduct,
  listItems,
  listMovements,
  listProducts,
  patchProduct,
  postItem,
  postItemTransition,
  postProduct,
  postQuantityMovement,
} from '../controllers/inventory.controller.js';
import { requireRoles } from '../middleware/authorization.middleware.js';

const router = Router();
const writer = requireRoles('rdx_admin');

router.get('/products', listProducts);
router.post('/products', writer, postProduct);
router.get('/products/:id', getProduct);
router.patch('/products/:id', writer, patchProduct);
router.get('/products/:id/items', listItems);
router.post('/products/:id/items', writer, postItem);
router.post('/products/:id/movements', writer, postQuantityMovement);
router.post('/items/:id/transition', writer, postItemTransition);
router.get('/movements', listMovements);

export default router;
