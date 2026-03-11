/**
 * Script de Backup Completo do MongoDB Atlas
 *
 * - Usa `mongodump` para fazer backup completo do banco
 * - Comprime em arquivo .gz
 * - Mantém apenas os ultimos 7 backups (rotacao automatica)
 * - Operacao READ-ONLY: nenhum dado e alterado no banco
 *
 * Pre-requisito: MongoDB Database Tools instalado
 * Download: https://www.mongodb.com/try/download/database-tools
 *
 * Uso manual: npx ts-node src/scripts_bak/backupDatabase.ts
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const BACKUP_DIR = path.resolve(__dirname, '../../backups');
const MAX_BACKUPS = 7;

// Caminhos padroes de instalacao do mongodump no Windows
const MONGODUMP_PATHS = [
  'mongodump', // PATH do sistema
  'C:\\Program Files\\MongoDB\\Tools\\100\\bin\\mongodump.exe',
  'C:\\Program Files\\MongoDB\\Server\\8.0\\bin\\mongodump.exe',
  'C:\\Program Files\\MongoDB\\Server\\7.0\\bin\\mongodump.exe',
];

function findMongodump(): string | null {
  for (const cmd of MONGODUMP_PATHS) {
    try {
      execSync(`"${cmd}" --version`, { stdio: 'pipe' });
      return cmd;
    } catch {
      // tenta o proximo
    }
  }
  return null;
}

function getTimestamp(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}_${hh}-${min}`;
}

function ensureBackupDir(): void {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    console.log(`[BACKUP] Diretorio criado: ${BACKUP_DIR}`);
  }
}

function rotateBackups(): void {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('backup_') && f.endsWith('.gz'))
    .map(f => ({
      name: f,
      path: path.join(BACKUP_DIR, f),
      time: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime(),
    }))
    .sort((a, b) => a.time - b.time); // mais antigo primeiro

  while (files.length >= MAX_BACKUPS) {
    const oldest = files.shift()!;
    fs.unlinkSync(oldest.path);
    console.log(`[BACKUP] Removido backup antigo: ${oldest.name}`);
  }
}

export async function runBackup(): Promise<boolean> {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    console.error('[BACKUP] ERRO: MONGODB_URI nao definida no .env');
    return false;
  }

  console.log('[BACKUP] Iniciando backup completo do MongoDB Atlas...');
  console.log(`[BACKUP] Data/Hora: ${new Date().toLocaleString('pt-BR')}`);

  try {
    // Localiza mongodump no sistema
    const mongodumpCmd = findMongodump();
    if (!mongodumpCmd) {
      console.error('[BACKUP] ERRO: mongodump nao encontrado!');
      console.error('[BACKUP] Instale o MongoDB Database Tools:');
      console.error('[BACKUP] https://www.mongodb.com/try/download/database-tools');
      return false;
    }
    console.log(`[BACKUP] mongodump encontrado: ${mongodumpCmd}`);

    ensureBackupDir();
    rotateBackups();

    const timestamp = getTimestamp();
    const backupFile = path.join(BACKUP_DIR, `backup_${timestamp}.gz`);

    // mongodump com --archive e --gzip gera um unico arquivo comprimido
    // Operacao 100% READ-ONLY - apenas le dados do banco
    const command = `"${mongodumpCmd}" --uri="${mongoUri}" --gzip --archive="${backupFile}"`;

    console.log(`[BACKUP] Executando mongodump...`);
    console.log(`[BACKUP] Destino: ${backupFile}`);

    execSync(command, {
      stdio: 'pipe',
      timeout: 10 * 60 * 1000, // timeout de 10 minutos
    });

    // Verifica se o arquivo foi criado e tem conteudo
    const stats = fs.statSync(backupFile);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

    console.log(`[BACKUP] Backup concluido com sucesso!`);
    console.log(`[BACKUP] Arquivo: ${backupFile}`);
    console.log(`[BACKUP] Tamanho: ${sizeMB} MB`);

    // Lista backups atuais
    const currentBackups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('backup_') && f.endsWith('.gz'))
      .sort();
    console.log(`[BACKUP] Total de backups armazenados: ${currentBackups.length}/${MAX_BACKUPS}`);

    return true;
  } catch (error: any) {
    console.error('[BACKUP] ERRO ao executar backup:', error.message);
    if (error.stderr) {
      console.error('[BACKUP] Detalhes:', error.stderr.toString());
    }
    return false;
  }
}

// Execucao direta do script
if (require.main === module) {
  runBackup().then(success => {
    process.exit(success ? 0 : 1);
  });
}
