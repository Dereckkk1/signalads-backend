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
      console.warn(`⚠️  Arquivo de credenciais não encontrado: ${keyFilePath}`);
      return false;
    }
  }

  return hasVars;
};

const USE_GOOGLE_CLOUD = isGoogleCloudConfigured();

if (!USE_GOOGLE_CLOUD) {
  console.warn('⚠️  Google Cloud Storage NÃO configurado. O sistema apresentará erros ao tentar fazer uploads.');
  console.warn('⚠️  Configure as variáveis: GOOGLE_CLOUD_KEY_FILE, GOOGLE_CLOUD_PROJECT_ID, GOOGLE_CLOUD_BUCKET_NAME');
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

    console.log('✅ Arquivo enviado para Cloud Storage:', publicUrl);

    return publicUrl;
  } catch (error: any) {
    console.error('❌ Erro no Google Cloud Storage:', error.message);
    throw new Error(`Erro ao fazer upload no bucket: ${error.message}`);
  }
};

/**
 * Deleta arquivo do Cloud Storage
 * @param fileUrl - URL completa do arquivo
 */
export const deleteFile = async (fileUrl: string): Promise<void> => {
  try {
    if (!USE_GOOGLE_CLOUD) {
      throw new Error('Google Cloud Storage não configurado. Deleções locais foram desativadas.');
    }

    if (!bucket || !bucketName) {
      throw new Error('Google Cloud Storage não inicializado');
    }

    // Extrai o nome do arquivo da URL
    const fileName = fileUrl.split(`${bucketName}/`)[1];

    if (!fileName) {
      throw new Error('URL inválida');
    }

    await bucket.file(fileName).delete();

    console.log('🗑️ Arquivo deletado do Cloud Storage:', fileName);
  } catch (error) {
    console.error('❌ Erro ao deletar arquivo:', error);
    throw new Error('Erro ao deletar arquivo');
  }
};

/**
 * Gera URL assinada temporária (24 horas) para arquivo privado
 * Útil se no futuro quiser arquivos privados com acesso controlado
 */
export const getSignedUrl = async (filePath: string): Promise<string> => {
  try {
    const [url] = await bucket.file(filePath).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 24 * 60 * 60 * 1000, // 24 horas
    });

    return url;
  } catch (error) {
    console.error('❌ Erro ao gerar URL assinada:', error);
    throw new Error('Erro ao gerar URL de acesso');
  }
};

export default storage;
