/**
 * Cron Job - Backup automatico do MongoDB Atlas
 * Executa todos os dias a meia-noite (00:00)
 */

import cron from 'node-cron';
import { runBackup } from '../scripts_bak/backupDatabase';

export function startBackupCron(): void {
  // Cron: "0 0 * * *" = todo dia a meia-noite
  cron.schedule('0 0 * * *', async () => {
    console.log('\n========================================');
    console.log('[CRON] Backup agendado iniciado - meia-noite');
    console.log('========================================\n');

    const success = await runBackup();

    if (success) {
      console.log('[CRON] Backup concluido com sucesso.');
    } else {
      console.error('[CRON] FALHA no backup! Verifique os logs acima.');
    }

    console.log('\n========================================\n');
  }, {
    timezone: 'America/Sao_Paulo',
  });

  console.log('[CRON] Backup agendado para todos os dias a meia-noite (America/Sao_Paulo)');
}
