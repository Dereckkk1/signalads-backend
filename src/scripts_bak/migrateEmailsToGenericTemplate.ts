/**
 * Script de Migração de Emails para Template Genérico
 * 
 * Este script documenta quais emails precisam ser migrados do sistema antigo
 * (emailTemplate) para o novo sistema genérico (createEmailTemplate).
 * 
 * Status: MIGRAÇÃO PENDENTE
 */

const emailsToMigrate = [
  {
    function: 'sendNewOrderToBroadcaster',
    status: '✅ MIGRADO',
    description: 'Email para emissora quando recebe novo pedido'
  },
  {
    function: 'sendOrderConfirmationToClient',
    status: '⏳ PENDENTE',
    description: 'Confirmação de compra para o cliente'
  },
  {
    function: 'sendOrderApprovedToClient',
    status: '⏳ PENDENTE',
    description: 'Notificação de pedido aprovado'
  },
  {
    function: 'sendOrderRejectedToClient',
    status: '⏳ PENDENTE',
    description: 'Notificação de pedido rejeitado'
  },
  {
    function: 'sendOrderCancelledToClient',
    status: '⏳ PENDENTE',
    description: 'Notificação de pedido cancelado'
  },
  {
    function: 'sendMaterialRevisionRequest',
    status: '⏳ PENDENTE',
    description: 'Solicitação de revisão de material'
  },
  {
    function: 'sendMaterialProduced',
    status: '⏳ PENDENTE',
    description: 'Material produzido pela emissora'
  },
  {
    function: 'sendMaterialApproved',
    status: '⏳ PENDENTE',
    description: 'Material aprovado pelo cliente'
  },
  {
    function: 'sendMaterialRevisionFromClient',
    status: '⏳ PENDENTE',
    description: 'Cliente solicitou ajustes no material'
  },
  {
    function: 'sendBillingPendingValidation',
    status: '⏳ PENDENTE',
    description: 'Pedido A Faturar aguardando validação'
  },
  {
    function: 'sendBillingAdminNotification',
    status: '⏳ PENDENTE',
    description: 'Notificação para admin de pedido A Faturar'
  },
  {
    function: 'sendBillingApproved',
    status: '⏳ PENDENTE',
    description: 'Pedido A Faturar aprovado'
  },
  {
    function: 'sendBillingRejected',
    status: '⏳ PENDENTE',
    description: 'Pedido A Faturar rejeitado'
  },
  {
    function: 'sendInvoiceIssued',
    status: '⏳ PENDENTE',
    description: 'Fatura emitida'
  },
  {
    function: 'sendPaymentReminder',
    status: '⏳ PENDENTE',
    description: 'Lembrete de pagamento'
  },
  {
    function: 'sendBroadcasterInvoiceRequest',
    status: '⏳ PENDENTE',
    description: 'Solicitação de NF para emissora'
  },
  {
    function: 'sendBillingOrderToBroadcaster',
    status: '⏳ PENDENTE',
    description: 'Pedido A Faturar para emissora'
  },
  {
    function: 'sendPaymentConfirmed',
    status: '⏳ PENDENTE',
    description: 'Pagamento confirmado'
  },
  {
    function: 'sendTwoFactorEnableEmail',
    status: '✅ MIGRADO',
    description: 'Ativação de autenticação em duas etapas'
  },
  {
    function: 'sendTwoFactorLoginEmail',
    status: '✅ MIGRADO',
    description: 'Confirmação de login com 2FA'
  }
];

console.log('\n📧 STATUS DE MIGRAÇÃO DOS EMAILS\n');
console.log('='.repeat(80));

let migrated = 0;
let pending = 0;

emailsToMigrate.forEach(email => {
  console.log(`\n${email.status} ${email.function}`);
  console.log(`   ${email.description}`);
  
  if (email.status === '✅ MIGRADO') {
    migrated++;
  } else {
    pending++;
  }
});

console.log('\n' + '='.repeat(80));
console.log(`\nRESUMO: ${migrated} migrados | ${pending} pendentes | ${emailsToMigrate.length} total`);
console.log(`Progresso: ${Math.round((migrated / emailsToMigrate.length) * 100)}%\n`);

console.log('ℹ️  Para migrar, substitua:');
console.log('   emailTemplate(content, preheader)');
console.log('   por');
console.log('   createEmailTemplate({ title, subtitle, icon, content, buttonText, buttonUrl, ... })\n');

export default emailsToMigrate;
