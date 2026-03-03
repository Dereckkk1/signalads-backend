import { Response } from 'express';
import multer from 'multer';
import { AuthRequest } from '../middleware/auth';
import { uploadFile } from '../config/storage';
import { Cart } from '../models/Cart';

// Helper para retry em caso de VersionError do Mongoose
const saveWithRetry = async (cart: any, itemIndex: number, material: any, maxRetries = 3): Promise<void> => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Recarrega o cart mais recente antes de atualizar
      const freshCart = await Cart.findById(cart._id);
      if (!freshCart) {
        throw new Error('Carrinho não encontrado');
      }

      // Aplica a atualização no documento fresco
      if (!freshCart.items[itemIndex]) {
        throw new Error('Item não encontrado no índice especificado');
      }

      freshCart.items[itemIndex].material = material;
      await freshCart.save();

      return;
    } catch (error: any) {
      if (error.name === 'VersionError' && attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 100 * attempt)); // Backoff exponencial
        continue;
      }
      throw error;
    }
  }
};

// Configuração do Multer para upload em memória
const storage = multer.memoryStorage();

const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Tipos de arquivo permitidos
  const allowedAudioTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav'];
  const allowedDocTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ];

  const allAllowed = [...allowedAudioTypes, ...allowedDocTypes];

  if (allAllowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de arquivo não permitido'));
  }
};

export const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  }
});

// Upload de áudio
export const uploadAudio = async (req: AuthRequest, res: Response): Promise<void> => {
  console.log('📬 Recebendo requisição de upload de áudio:', {
    fileName: req.file?.originalname,
    fileSize: req.file?.size,
    productId: req.body.productId,
    userId: req.userId
  });
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'Nenhum arquivo enviado' });
      return;
    }

    const { productId } = req.body;

    if (!productId) {
      res.status(400).json({ error: 'ID do produto não fornecido' });
      return;
    }

    // Upload para Cloud Storage
    const fileUrl = await uploadFile(
      req.file.buffer,
      req.file.originalname,
      'audio',
      req.file.mimetype
    );

    // Atualiza carrinho com URL do áudio
    const cart = await Cart.findOne({ userId: req.userId });

    if (!cart) {
      res.status(404).json({ error: 'Carrinho não encontrado' });
      return;
    }

    const itemIndex = cart.items.findIndex(
      item => item.productId.toString() === productId
    );

    if (itemIndex === -1) {
      res.status(404).json({ error: 'Item não encontrado no carrinho' });
      return;
    }

    if (!cart.items[itemIndex]) {
      res.status(404).json({ error: 'Item não encontrado no carrinho' });
      return;
    }

    // Prepara material
    const material = {
      type: 'audio',
      audioUrl: fileUrl,
      audioFileName: req.file.originalname,
      audioFileSize: req.file.size,
      uploadedAt: new Date()
    };

    await saveWithRetry(cart, itemIndex, material);



    res.json({
      success: true,
      url: fileUrl,
      fileName: req.file.originalname,
      fileSize: req.file.size
    });
  } catch (error) {
    console.error('❌ Erro ao fazer upload de áudio:', error);
    res.status(500).json({ error: 'Erro ao fazer upload do áudio' });
  }
};

// Upload de roteiro
export const uploadScript = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'Nenhum arquivo enviado' });
      return;
    }

    const { productId } = req.body;

    if (!productId) {
      res.status(400).json({ error: 'ID do produto não fornecido' });
      return;
    }

    // Upload para Cloud Storage
    const fileUrl = await uploadFile(
      req.file.buffer,
      req.file.originalname,
      'scripts',
      req.file.mimetype
    );

    // Atualiza carrinho com URL do roteiro
    const cart = await Cart.findOne({ userId: req.userId });

    if (!cart) {
      res.status(404).json({ error: 'Carrinho não encontrado' });
      return;
    }

    const itemIndex = cart.items.findIndex(
      item => item.productId.toString() === productId
    );

    if (itemIndex === -1) {
      res.status(404).json({ error: 'Item não encontrado no carrinho' });
      return;
    }

    if (!cart.items[itemIndex]) {
      res.status(404).json({ error: 'Item não encontrado no carrinho' });
      return;
    }

    // Prepara material
    const material = {
      type: 'script',
      scriptUrl: fileUrl,
      scriptFileName: req.file.originalname,
      scriptFileSize: req.file.size,
      uploadedAt: new Date()
    };

    await saveWithRetry(cart, itemIndex, material);



    res.json({
      success: true,
      url: fileUrl,
      fileName: req.file.originalname,
      fileSize: req.file.size
    });
  } catch (error) {
    console.error('❌ Erro ao fazer upload de roteiro:', error);
    res.status(500).json({ error: 'Erro ao fazer upload do roteiro' });
  }
};

// Salvar texto
export const saveText = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    const { productId, text, wordCount, duration } = req.body;

    if (!productId || !text) {
      res.status(400).json({ error: 'Dados inválidos' });
      return;
    }

    // Atualiza carrinho com texto
    const cart = await Cart.findOne({ userId: req.userId });

    if (!cart) {
      res.status(404).json({ error: 'Carrinho não encontrado' });
      return;
    }

    const itemIndex = cart.items.findIndex(
      item => item.productId.toString() === productId
    );

    if (itemIndex === -1) {
      res.status(404).json({ error: 'Item não encontrado no carrinho' });
      return;
    }

    if (!cart.items[itemIndex]) {
      res.status(404).json({ error: 'Item não encontrado no carrinho' });
      return;
    }

    // Prepara material
    const material = {
      type: 'text',
      text,
      wordCount: wordCount,
      textDuration: duration,
      uploadedAt: new Date()
    };

    await saveWithRetry(cart, itemIndex, material);



    res.json({
      success: true,
      wordCount,
      duration
    });
  } catch (error) {
    console.error('❌ Erro ao salvar texto:', error);
    res.status(500).json({ error: 'Erro ao salvar texto' });
  }
};
