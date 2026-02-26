import express from 'express';
import {
  getDashboard,
  getClients,
  createClient,
  updateClient,
  deleteClient
} from '../controllers/agencyController';
import { authenticateToken } from '../middleware/auth';

const router = express.Router();

router.use(authenticateToken);

router.get('/dashboard', getDashboard);

router.route('/clients')
  .get(getClients)
  .post(createClient);

router.route('/clients/:id')
  .put(updateClient)
  .delete(deleteClient);

export default router;
