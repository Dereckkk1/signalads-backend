import express from 'express';
import { getAppSheetImage } from '../controllers/imageController';

const router = express.Router();

// GET /api/images/proxy?fileName=...
router.get('/proxy', getAppSheetImage);

export default router;
