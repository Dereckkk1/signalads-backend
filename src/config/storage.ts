import { Storage } from '@google-cloud/storage';
import path from 'path';
import fs from 'fs';

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
 * Faz upload de arquivo para o Google Cloud Storage
 * @param file - Buffer do arquivo
 * @param fileName - Nome do arquivo no storage
 * @param folder - Pasta dentro do bucket (ex: 'audio', 'scripts')
 * @param contentType - MIME type do arquivo
 * @returns URL pública do arquivo
 */
export const uploadFile = async (
  file: Buffer,
  fileName: string,
  folder: string,
  contentType: string
): Promise<string> => {
  const timestamp = Date.now();
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');

  if (!USE_GOOGLE_CLOUD) {
    throw new Error('Google Cloud Storage não configurado. Uploads locais foram desativados.');
  }

  try {
    if (!bucket) {
      throw new Error('Google Cloud Storage não inicializado');
    }

    const gcsBucketName = process.env.GOOGLE_CLOUD_BUCKET_NAME || 'signalads-materials';
    const destination = `${folder}/${timestamp}-${sanitizedFileName}`;
    const fileUpload = bucket.file(destination);

    await fileUpload.save(file, {
      contentType: contentType,
      metadata: {
        cacheControl: 'public, max-age=31536000',
      },
    });

    await fileUpload.makePublic();

    const publicUrl = `https://storage.googleapis.com/${gcsBucketName}/${destination}`;

    return publicUrl;
  } catch (error: any) {
    throw new Error(`Erro ao fazer upload no bucket: ${error.message}`);
  }
};

export default storage;
