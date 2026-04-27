import { Response } from 'express';
import path from 'path';
import multer from 'multer';
import { fromBuffer } from 'file-type';
import { AuthRequest } from '../middleware/auth';
import { uploadFile, getSignedReadUrl } from '../config/storage';
import { Cart } from '../models/Cart';

// Magic bytes permitidos por categoria (#44)
const ALLOWED_AUDIO_MAGIC = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave'];
const ALLOWED_DOC_MAGIC = ['application/pdf'];
// DOC/DOCX/TXT nao tem magic bytes confiáveis — validados por MIME+extensão apenas

// Sanitiza um filename para persistência em DB / chat / metadados.
// Remove tags HTML, controles e limita comprimento. Não usado como chave de
// armazenamento (essa é gerada com crypto.randomUUID em storage.ts).
const sanitizeFileName = (name: string): string => {
  if (!name || typeof name !== 'string') return 'arquivo';
  return name
    .replace(/[<>"'&\x00-\x1f]/g, '_')
    .slice(0, 200);
};

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

// Extensoes permitidas (validacao dupla: MIME + extensao)
const allowedExtensions = new Set(['.mp3', '.wav', '.pdf', '.doc', '.docx', '.txt']);

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

  // Valida MIME type
  if (!allAllowed.includes(file.mimetype)) {
    return cb(new Error('Tipo de arquivo não permitido'));
  }

  // Valida extensao do arquivo (previne MIME spoofing)
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowedExtensions.has(ext)) {
    return cb(new Error('Extensão de arquivo não permitida'));
  }

  cb(null, true);
};

export const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  }
});

// Upload de áudio
// Ordem: validate (auth, cart, item) -> magic-byte sniff -> upload -> persist.
// O upload para GCS ocorre SOMENTE depois que sabemos que o usuário tem direito
// de gravar no carrinho — evita lixo perpétuo no bucket por requests inválidos.
export const uploadAudio = async (req: AuthRequest, res: Response): Promise<void> => {
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

    // 1) Validação de magic bytes — impede upload de executáveis disfarçados (#44)
    const fileType = await fromBuffer(req.file.buffer);
    if (fileType && !ALLOWED_AUDIO_MAGIC.includes(fileType.mime)) {
      res.status(400).json({ error: 'Conteúdo do arquivo não corresponde a um áudio válido' });
      return;
    }

    // 2) Validação de propriedade do carrinho ANTES de gastar storage no bucket
    const cart = await Cart.findOne({ userId: req.userId });

    if (!cart) {
      res.status(404).json({ error: 'Carrinho não encontrado' });
      return;
    }

    const itemIndex = cart.items.findIndex(
      item => item.productId.toString() === productId
    );

    if (itemIndex === -1 || !cart.items[itemIndex]) {
      res.status(404).json({ error: 'Item não encontrado no carrinho' });
      return;
    }

    // 3) Só agora fazemos o upload pro GCS (a essa altura sabemos que o slot existe e é do usuário)
    const fileUrl = await uploadFile(
      req.file.buffer,
      req.file.originalname,
      'audio',
      req.file.mimetype
    );

    const safeName = sanitizeFileName(req.file.originalname);

    // 4) Persiste no carrinho
    const material = {
      type: 'audio',
      audioUrl: fileUrl,
      audioFileName: safeName,
      audioFileSize: req.file.size,
      uploadedAt: new Date()
    };

    await saveWithRetry(cart, itemIndex, material);

    res.json({
      success: true,
      url: fileUrl,
      fileName: safeName,
      fileSize: req.file.size
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao fazer upload do áudio' });
  }
};

// Upload de roteiro
// Mesma ordem aplicada do uploadAudio: validate -> sniff -> upload -> persist.
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

    // 1) Validação de magic bytes para PDFs (#44)
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (ext === '.pdf') {
      const fileType = await fromBuffer(req.file.buffer);
      if (!fileType || fileType.mime !== 'application/pdf') {
        res.status(400).json({ error: 'Conteúdo do arquivo não corresponde a um PDF válido' });
        return;
      }
    }

    // 2) Validação de propriedade do carrinho ANTES de subir ao bucket
    const cart = await Cart.findOne({ userId: req.userId });

    if (!cart) {
      res.status(404).json({ error: 'Carrinho não encontrado' });
      return;
    }

    const itemIndex = cart.items.findIndex(
      item => item.productId.toString() === productId
    );

    if (itemIndex === -1 || !cart.items[itemIndex]) {
      res.status(404).json({ error: 'Item não encontrado no carrinho' });
      return;
    }

    // 3) Upload ao GCS
    const fileUrl = await uploadFile(
      req.file.buffer,
      req.file.originalname,
      'scripts',
      req.file.mimetype
    );

    const safeName = sanitizeFileName(req.file.originalname);

    // 4) Persiste no carrinho
    const material = {
      type: 'script',
      scriptUrl: fileUrl,
      scriptFileName: safeName,
      scriptFileSize: req.file.size,
      uploadedAt: new Date()
    };

    await saveWithRetry(cart, itemIndex, material);

    res.json({
      success: true,
      url: fileUrl,
      fileName: safeName,
      fileSize: req.file.size
    });
  } catch (error) {
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
    res.status(500).json({ error: 'Erro ao salvar texto' });
  }
};

// Gera signed URL temporária para leitura de um objeto GCS privado.
// Auth-required (router já aplica `authenticateToken`).
//
// NOTA SEGURANÇA: este endpoint NÃO realiza checagem de ownership granular
// (ex: "este audioUrl pertence a um pedido do usuário X?"). Toda a checagem
// no momento é "usuário autenticado", o que já fecha o vetor de exposição
// pública para o mundo. Uma checagem por-objeto é um followup desejável,
// mas exige inverter o storage para guardar o objectKey + dono no banco;
// hoje o objectKey é opaco e basicamente significa "qualquer URL do bucket".
//
// Para mitigar enquanto a refatoração maior não acontece:
// - Bucket está privado (sem makePublic).
// - Signed URL é de TTL curto (15min).
// - Object keys agora são UUIDs aleatórios, não previsíveis por timestamp.
export const getStorageSignedUrl = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Usuário não autenticado' });
      return;
    }

    const objectKey = (req.query.objectKey || req.query.url || '') as string;
    if (!objectKey) {
      res.status(400).json({ error: 'Parâmetro objectKey é obrigatório' });
      return;
    }

    const url = await getSignedReadUrl(objectKey, 15);
    res.json({ url, expiresInSeconds: 15 * 60 });
  } catch (error: any) {
    res.status(400).json({ error: 'Não foi possível gerar URL assinada' });
  }
};
