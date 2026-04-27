import { Storage } from '@google-cloud/storage';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// URL base para arquivos locais (desenvolvimento)
const API_URL = process.env.API_URL || 'http://localhost:5000';

// Verifica se as credenciais do Google Cloud estão configuradas
const isGoogleCloudConfigured = () => {
  // Verifica se todas as variáveis existem
  const hasVars = Boolean(
    process.env.GOOGLE_CLOUD_KEY_FILE &&
    process.env.GOOGLE_CLOUD_PROJECT_ID &&
    process.env.GOOGLE_CLOUD_BUCKET_NAME
  );

  // Verifica se o arquivo de credenciais existe
  if (hasVars && process.env.GOOGLE_CLOUD_KEY_FILE) {
    const keyFilePath = process.env.GOOGLE_CLOUD_KEY_FILE;
    if (!fs.existsSync(keyFilePath)) {
      return false;
    }
  }

  return hasVars;
};

const USE_GOOGLE_CLOUD = isGoogleCloudConfigured();

if (!USE_GOOGLE_CLOUD) {
  // Google Cloud Storage not configured
}

// Configuração do Google Cloud Storage (apenas se configurado)
let storage: Storage | null = null;
let bucket: any = null;
let bucketName: string = '';

if (USE_GOOGLE_CLOUD) {
  storage = new Storage({
    keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE,
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID
  });

  bucketName = process.env.GOOGLE_CLOUD_BUCKET_NAME || 'E-rádios-materials';
  bucket = storage.bucket(bucketName);
}

/**
 * Faz upload de arquivo para o Google Cloud Storage.
 *
 * IMPORTANTE: arquivos NÃO são tornados públicos. O acesso é mediado pelo
 * backend via signed URLs (ver `getSignedReadUrl`) ou rota proxy `/api/storage/signed-url`.
 *
 * O nome final do objeto NÃO contém o originalname (evita leak de nome do
 * arquivo do usuário), apenas a extensão sanitizada.
 *
 * @param file - Buffer do arquivo
 * @param fileName - Nome original (usado APENAS para extrair extensão; não é persistido no objectKey)
 * @param folder - Pasta dentro do bucket (ex: 'audio', 'scripts')
 * @param contentType - MIME type do arquivo
 * @returns URL pública do arquivo (continua no formato `https://storage.googleapis.com/<bucket>/<key>`
 *          para compatibilidade com modelos existentes; o objeto em si é PRIVADO).
 */
export const uploadFile = async (
  file: Buffer,
  fileName: string,
  folder: string,
  contentType: string
): Promise<string> => {
  if (!USE_GOOGLE_CLOUD) {
    throw new Error('Google Cloud Storage não configurado. Uploads locais foram desativados.');
  }

  try {
    if (!bucket) {
      throw new Error('Google Cloud Storage não inicializado');
    }

    const gcsBucketName = process.env.GOOGLE_CLOUD_BUCKET_NAME || 'signalads-materials';

    // Extrai apenas a extensão, limitando tamanho e caracteres permitidos.
    // Não embute o originalname no objectKey (evita leak de nome do arquivo do usuário).
    const ext = path.extname(fileName || '').slice(0, 10).replace(/[^a-zA-Z0-9.]/g, '');
    const destination = `${folder}/${crypto.randomUUID()}${ext}`;
    const fileUpload = bucket.file(destination);

    await fileUpload.save(file, {
      contentType: contentType,
      // Cache shorter — signed URLs expiram em minutos, então cache longo é inútil/perigoso.
      metadata: {
        cacheControl: 'private, max-age=60',
      },
    });

    // Não chamamos `makePublic()`. O objeto fica privado por default;
    // ACL/IAM do bucket controla quem pode ler. Acesso público é fechado.

    // Retornamos a URL "padrão" do GCS para compatibilidade com schema existente.
    // Como o objeto é privado, esta URL retorna 403 sem credenciais — o frontend
    // deve consumir via signed-url proxy (TODO: follow-up de frontend).
    const publicUrl = `https://storage.googleapis.com/${gcsBucketName}/${destination}`;

    return publicUrl;
  } catch (error: any) {
    // Não propaga o erro do GCS para o caller; o controller decide a mensagem
    // genérica que vai pro client. Log do detalhe ocorre aqui.
    console.error('[storage.uploadFile] erro:', error?.message || error);
    throw new Error('Erro ao processar upload');
  }
};

/**
 * Gera signed URL temporária (default 15min) para leitura de um objeto privado.
 *
 * @param objectPath - Pode ser o objectKey puro (ex: `audio/abc-123.mp3`) ou
 *                     a URL completa `https://storage.googleapis.com/<bucket>/<key>`
 *                     (neste caso o prefixo é removido).
 * @param ttlMinutes - TTL em minutos (default 15)
 */
export async function getSignedReadUrl(objectPath: string, ttlMinutes = 15): Promise<string> {
  if (!USE_GOOGLE_CLOUD || !bucket) {
    throw new Error('Google Cloud Storage não configurado');
  }
  if (!objectPath) {
    throw new Error('objectPath obrigatório');
  }

  const gcsBucketName = process.env.GOOGLE_CLOUD_BUCKET_NAME || 'signalads-materials';
  let key = objectPath;

  // Se vier URL completa do GCS, extrai apenas o object key
  const prefix = `https://storage.googleapis.com/${gcsBucketName}/`;
  if (key.startsWith(prefix)) {
    key = key.slice(prefix.length);
  }

  // Defesa em profundidade: rejeita object keys com `..` ou caracteres exóticos
  if (key.includes('..') || !/^[a-zA-Z0-9._\-/]+$/.test(key)) {
    throw new Error('objectPath inválido');
  }

  const file = bucket.file(key);
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + ttlMinutes * 60 * 1000,
  });
  return url as string;
}

/**
 * Verifica se uma URL é uma URL "padrão" do GCS para nosso bucket.
 * Usado pelo proxy de signed URL para validar input.
 */
export function isOurGcsUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const gcsBucketName = process.env.GOOGLE_CLOUD_BUCKET_NAME || 'signalads-materials';
  return url.startsWith(`https://storage.googleapis.com/${gcsBucketName}/`);
}

export default storage;
