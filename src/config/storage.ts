import { Storage } from '@google-cloud/storage';
import path from 'path';
import fs from 'fs';

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

// Flag para forçar modo local (útil para desenvolvimento)
const FORCE_LOCAL_STORAGE = process.env.FORCE_LOCAL_STORAGE === 'true';

let USE_GOOGLE_CLOUD = isGoogleCloudConfigured() && !FORCE_LOCAL_STORAGE;

// Sempre cria diretórios locais (fallback)
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
['audio', 'scripts', 'billing-documents'].forEach(folder => {
  const folderPath = path.join(uploadsDir, folder);
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
});

if (!USE_GOOGLE_CLOUD) {
  console.warn('⚠️  Google Cloud Storage NÃO configurado. Usando armazenamento local para desenvolvimento.');
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
  
  // Função auxiliar para salvar localmente
  const saveLocally = (): string => {
    const uploadsDir = path.join(__dirname, '../../uploads');
    const folderPath = path.join(uploadsDir, folder);
    
    // Garante que o diretório existe
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
    
    const destination = path.join(folderPath, `${timestamp}-${sanitizedFileName}`);
    fs.writeFileSync(destination, file);
    
    const localUrl = `http://localhost:5000/uploads/${folder}/${timestamp}-${sanitizedFileName}`;
    console.log('✅ Arquivo salvo localmente:', localUrl);
    
    return localUrl;
  };
  
  // MODO LOCAL (sem Google Cloud ou forçado)
  if (!USE_GOOGLE_CLOUD) {
    return saveLocally();
  }
  
  // MODO GOOGLE CLOUD (com fallback para local em caso de erro)
  try {
    if (!bucket) {
      throw new Error('Google Cloud Storage não inicializado');
    }
    
    const gcsBucketName = process.env.GOOGLE_CLOUD_BUCKET_NAME || 'E-rádios-materials';
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
    console.warn('⚠️  Usando fallback para armazenamento local...');
    
    // Desabilita GCS para próximas chamadas nesta sessão
    USE_GOOGLE_CLOUD = false;
    
    return saveLocally();
  }
};

/**
 * Deleta arquivo do Cloud Storage
 * @param fileUrl - URL completa do arquivo
 */
export const deleteFile = async (fileUrl: string): Promise<void> => {
  try {
    if (!USE_GOOGLE_CLOUD) {
      // Modo local: deleta arquivo do sistema de arquivos
      const localPath = fileUrl.replace('http://localhost:5000', path.join(__dirname, '../..'));
      if (fs.existsSync(localPath)) {
        fs.unlinkSync(localPath);
        console.log('🗑️ Arquivo deletado localmente:', localPath);
      }
      return;
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
