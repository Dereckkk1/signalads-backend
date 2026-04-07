import express, { Response, NextFunction } from 'express';
import {
  getDashboard,
  getClients,
  createClient,
  updateClient,
  deleteClient
} from '../controllers/agencyController';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

router.use(authenticateToken);

// Defense-in-depth: role check no middleware (controller tambem valida)
const requireAgency = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.user?.userType !== 'agency') {
    res.status(403).json({ error: 'Acesso restrito a agências' });
    return;
  }
  next();
};

router.get('/dashboard', requireAgency, getDashboard);

router.route('/clients')
  .get(requireAgency, getClients)
  .post(requireAgency, createClient);

router.route('/clients/:id')
  .put(requireAgency, updateClient)
  .delete(requireAgency, deleteClient);

export default router;
