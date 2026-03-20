import nodemailer from 'nodemailer';

// Configuração do transporter
// Em desenvolvimento, usa Ethereal (teste) ou as credenciais do .env
const createTransporter = () => {
  // Se estiver em produção com credenciais SMTP
  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  // Modo desenvolvimento: loga no console mas não envia
  return null;
};

const transporter = createTransporter();

// Cores da plataforma E-rádios (baseadas no variables.css)
const colors = {
  primary: '#4A90E2',      // Azul
  primaryDark: '#2B6CB0',
  primaryLight: '#7CB3F0',
  secondary: '#8B5CF6',    // Roxo
  secondaryDark: '#7C3AED',
  tertiary: '#EC4899',     // Rosa
  tertiaryDark: '#DB2777',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  gray50: '#F9FAFB',
  gray100: '#F3F4F6',
  gray200: '#E5E7EB',
  gray300: '#D1D5DB',
  gray400: '#9CA3AF',
  gray500: '#6B7280',
  gray600: '#4B5563',
  gray700: '#374151',
  gray800: '#1F2937',
  gray900: '#111827',
  white: '#FFFFFF',
  black: '#000000'
};

// ===========================================
// SISTEMA DE TEMPLATE GENÉRICO DE EMAIL
// ===========================================

/**
 * Interface para configuração de email
 */
interface EmailConfig {
  title: string;           // Título principal do email
  subtitle?: string;       // Subtítulo opcional
  content: string;         // Conteúdo HTML do email
  buttonText?: string;     // Texto do botão de ação
  buttonUrl?: string;      // URL do botão
  buttonColor?: string;    // Cor do botão (padrão: primary)
  preheader?: string;      // Texto de preview
  icon?: string;           // Emoji ou ícone principal
  showLogo?: boolean;      // Mostrar logo (padrão: true)
}

/**
 * Template base genérico - Sistema reutilizável de emails
 * Aceita configurações dinâmicas para criar qualquer tipo de email
 */
const createEmailTemplate = (config: EmailConfig): string => {
  const {
    title,
    subtitle,
    content,
    buttonText,
    buttonUrl,
    buttonColor = colors.tertiary,
    preheader = '',
    icon,
    showLogo = true
  } = config;

  // Logo da plataforma
  const logoUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/logomarca eradios.png`;

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>E-rádios</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td {font-family: Arial, Helvetica, sans-serif !important;}
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: ${colors.gray50}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  
  <!-- Preheader -->
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
    ${preheader || title}
  </div>
  
  <!-- Container principal -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background-color: ${colors.gray50}; padding: 40px 20px;">
    <tr>
      <td align="center">
        
        <!-- Card principal -->
        <table width="600" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background-color: ${colors.white}; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); overflow: hidden;">
          
          <!-- Header com logo -->
          <tr>
            <td style="background: ${colors.tertiary}; padding: 48px 32px; text-align: center;">
              ${showLogo ? `
              <!-- Logo -->
              <div style="margin-bottom: 24px;">
                <img src="${logoUrl}" alt="E-rádios" style="width: 180px; height: auto; display: block; margin: 0 auto;" />
              </div>
              ` : ''}
              
              ${icon ? `
              <!-- Ícone -->
              <div style="margin-bottom: 16px;">
                <img src="${logoUrl}" alt="${icon}" style="width: 100px; height: auto; display: block; margin: 0 auto;" />
              </div>
              ` : ''}
              
              <!-- Título -->
              <h1 style="margin: 0; color: ${colors.white}; font-size: 28px; font-weight: 700; letter-spacing: -0.5px; text-shadow: 0 2px 8px rgba(0,0,0,0.15); line-height: 1.3;">
                ${title}
              </h1>
              
              ${subtitle ? `
              <p style="margin: 12px 0 0; color: rgba(255,255,255,0.9); font-size: 16px; font-weight: 500; line-height: 1.5;">
                ${subtitle}
              </p>
              ` : ''}
            </td>
          </tr>
          
          <!-- Conteúdo -->
          <tr>
            <td style="padding: 48px 40px;">
              ${content}
            </td>
          </tr>
          
          ${buttonText && buttonUrl ? `
          <!-- Botão de ação -->
          <tr>
            <td style="padding: 0 40px 48px; text-align: center;">
              <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin: 0 auto;">
                <tr>
                  <td style="background-color: ${buttonColor}; border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,0.15);">
                    <a href="${buttonUrl}" style="display: inline-block; padding: 16px 48px; color: ${colors.white}; text-decoration: none; font-weight: 700; font-size: 16px; letter-spacing: 0.3px;">
                      ${buttonText}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ` : ''}
          
          <!-- Divider -->
          <tr>
            <td style="padding: 0 32px;">
              <div style="height: 1px; background: linear-gradient(90deg, transparent 0%, ${colors.gray200} 50%, transparent 100%);"></div>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 32px; text-align: center; background-color: ${colors.gray50};">
              <p style="margin: 0 0 12px; color: ${colors.gray500}; font-size: 13px; line-height: 1.6;">
                Este email foi enviado automaticamente pela plataforma E-rádios.
              </p>
              <p style="margin: 0 0 16px; color: ${colors.gray400}; font-size: 12px;">
                © ${new Date().getFullYear()} E-rádios - Todos os direitos reservados
              </p>
              
              <!-- Links do footer -->
              <div style="margin-top: 16px;">
                <a href="${process.env.FRONTEND_URL}" style="color: ${colors.tertiary}; text-decoration: none; font-size: 12px; margin: 0 8px;">Central de Ajuda</a>
                <span style="color: ${colors.gray300};">•</span>
                <a href="${process.env.FRONTEND_URL}/terms" style="color: ${colors.tertiary}; text-decoration: none; font-size: 12px; margin: 0 8px;">Termos de Uso</a>
                <span style="color: ${colors.gray300};">•</span>
                <a href="${process.env.FRONTEND_URL}/privacy" style="color: ${colors.tertiary}; text-decoration: none; font-size: 12px; margin: 0 8px;">Privacidade</a>
              </div>
            </td>
          </tr>
        </table>
        
        <!-- Texto abaixo do card -->
        <table width="600" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-top: 24px;">
          <tr>
            <td style="text-align: center; padding: 0 20px;">
              <p style="margin: 0; color: ${colors.gray400}; font-size: 11px; line-height: 1.5;">
                Você está recebendo este email porque possui uma conta na E-rádios.<br>
                <a href="${process.env.FRONTEND_URL}/unsubscribe" style="color: ${colors.gray500}; text-decoration: underline;">Gerenciar preferências de email</a>
              </p>
            </td>
          </tr>
        </table>
        
      </td>
    </tr>
  </table>
</body>
</html>
`;
};

/**
 * Componentes reutilizáveis para conteúdo de emails
 */

// Parágrafo de texto
export const paragraph = (text: string, options?: { bold?: boolean; center?: boolean }) => `
  <p style="margin: 0 0 16px; color: ${colors.gray700}; font-size: 15px; line-height: 1.7; ${options?.center ? 'text-align: center;' : ''} ${options?.bold ? 'font-weight: 600;' : ''}">
    ${text}
  </p>
`;

// Saudação personalizada
export const greeting = (name: string) => `
  <p style="margin: 0 0 24px; color: ${colors.gray700}; font-size: 15px; line-height: 1.6;">
    Olá <strong style="color: ${colors.gray900};">${name}</strong>,
  </p>
`;

// Card de informações
export const infoCard = (title: string, items: Array<{ label: string; value: string }>, color: string = colors.tertiary) => `
  <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="margin: 24px 0; background-color: ${colors.gray50}; border-left: 4px solid ${color}; border-radius: 8px; overflow: hidden;">
    <tr>
      <td style="padding: 20px 24px;">
        ${title ? `<h3 style="margin: 0 0 16px; color: ${color}; font-size: 16px; font-weight: 700;">${title}</h3>` : ''}
        <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%">
          ${items.map(item => `
          <tr>
            <td style="padding: 6px 0; color: ${colors.gray600}; font-size: 14px; font-weight: 600;">
              ${item.label}:
            </td>
            <td style="padding: 6px 0; color: ${colors.gray800}; font-size: 14px; text-align: right;">
              ${item.value}
            </td>
          </tr>
          `).join('')}
        </table>
      </td>
    </tr>
  </table>
`;

// Card de alerta/warning
export const alertCard = (text: string, type: 'success' | 'warning' | 'error' | 'info' = 'info') => {
  const colorMap = {
    success: { bg: '#ECFDF5', border: colors.success, icon: '✅' },
    warning: { bg: '#FEF3C7', border: colors.warning, icon: '⚠️' },
    error: { bg: '#FEE2E2', border: colors.error, icon: '❌' },
    info: { bg: '#FCE7F3', border: colors.tertiary, icon: 'ℹ️' }
  };

  const style = colorMap[type];

  return `
  <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="margin: 24px 0; background-color: ${style.bg}; border-left: 4px solid ${style.border}; border-radius: 8px;">
    <tr>
      <td style="padding: 16px 20px;">
        <p style="margin: 0; color: ${colors.gray800}; font-size: 14px; line-height: 1.6;">
          <strong style="font-size: 18px; margin-right: 8px;">${style.icon}</strong>
          ${text}
        </p>
      </td>
    </tr>
  </table>
`;
};

// Lista de itens
export const list = (items: string[], ordered: boolean = false) => `
  <${ordered ? 'ol' : 'ul'} style="margin: 16px 0; padding-left: 24px; color: ${colors.gray700}; font-size: 14px; line-height: 1.8;">
    ${items.map(item => `<li style="margin: 8px 0;">${item}</li>`).join('')}
  </${ordered ? 'ol' : 'ul'}>
`;

// Separador visual
export const divider = () => `
  <div style="margin: 32px 0; height: 1px; background: ${colors.gray300};"></div>
`;

// ===========================================
// TEMPLATE BASE LEGADO (MANTER COMPATIBILIDADE)
// ===========================================

// Template base do email - Design profissional E-rádios
const emailTemplate = (content: string, preheader: string = '') => `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>E-rádios</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td {font-family: Arial, Helvetica, sans-serif !important;}
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: ${colors.gray50}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <!-- Preheader -->
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
    ${preheader}
  </div>
  
  <!-- Container principal -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background-color: ${colors.gray50}; padding: 40px 20px;">
    <tr>
      <td align="center">
        <!-- Card principal -->
        <table width="600" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background-color: ${colors.white}; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); overflow: hidden;">
          
          <!-- Header com gradient -->
          <tr>
            <td style="background: linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary} 50%, ${colors.tertiary} 100%); padding: 40px 32px; text-align: center;">
              <!-- Logo -->
              <div style="background-color: ${colors.white}; width: 80px; height: 80px; margin: 0 auto 16px; border-radius: 20px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
                <span style="font-size: 48px; line-height: 1;">📻</span>
              </div>
              <!-- Nome da plataforma -->
              <h1 style="margin: 0; color: ${colors.white}; font-size: 28px; font-weight: 700; letter-spacing: -0.5px; text-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                E-rádios
              </h1>
              <p style="margin: 8px 0 0; color: rgba(255,255,255,0.9); font-size: 14px; font-weight: 500;">
                Mídia Programática para Rádio
              </p>
            </td>
          </tr>
          
          <!-- Conteúdo -->
          <tr>
            <td style="padding: 48px 32px;">
              ${content}
            </td>
          </tr>
          
          <!-- Divider -->
          <tr>
            <td style="padding: 0 32px;">
              <div style="height: 1px; background: linear-gradient(90deg, transparent 0%, ${colors.gray200} 50%, transparent 100%);"></div>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 32px; text-align: center; background-color: ${colors.gray50};">
              <p style="margin: 0 0 12px; color: ${colors.gray500}; font-size: 13px; line-height: 1.6;">
                Este email foi enviado automaticamente pela plataforma E-rádios.
              </p>
              <p style="margin: 0 0 16px; color: ${colors.gray400}; font-size: 12px;">
                © ${new Date().getFullYear()} E-rádios - Todos os direitos reservados
              </p>
              <!-- Links do footer -->
              <div style="margin-top: 16px;">
                <a href="${process.env.FRONTEND_URL}" style="color: ${colors.primary}; text-decoration: none; font-size: 12px; margin: 0 8px;">Central de Ajuda</a>
                <span style="color: ${colors.gray300};">•</span>
                <a href="${process.env.FRONTEND_URL}/terms" style="color: ${colors.primary}; text-decoration: none; font-size: 12px; margin: 0 8px;">Termos de Uso</a>
                <span style="color: ${colors.gray300};">•</span>
                <a href="${process.env.FRONTEND_URL}/privacy" style="color: ${colors.primary}; text-decoration: none; font-size: 12px; margin: 0 8px;">Privacidade</a>
              </div>
            </td>
          </tr>
        </table>
        
        <!-- Texto abaixo do card -->
        <table width="600" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-top: 24px;">
          <tr>
            <td style="text-align: center; padding: 0 20px;">
              <p style="margin: 0; color: ${colors.gray400}; font-size: 11px; line-height: 1.5;">
                Você está recebendo este email porque possui uma conta na E-rádios.<br>
                <a href="${process.env.FRONTEND_URL}/unsubscribe" style="color: ${colors.gray500}; text-decoration: underline;">Gerenciar preferências de email</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

// Componente de botão moderno
const buttonComponent = (text: string, url: string, color: string = colors.primary) => `
  <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin: 32px auto; text-align: center;">
    <tr>
      <td align="center">
        <a href="${url}" style="display: inline-block; background-color: ${color}; color: ${colors.white}; text-decoration: none; font-weight: 600; font-size: 15px; padding: 16px 40px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transition: all 0.3s ease;">
          ${text}
        </a>
      </td>
    </tr>
  </table>
`;

// Componente de info box
const infoBox = (title: string, items: Array<{ label: string, value: string }>) => `
  <div style="background-color: ${colors.gray100}; border-radius: 6px; padding: 16px; margin: 16px 0;">
    <h3 style="margin: 0 0 12px; color: ${colors.gray800}; font-size: 14px; font-weight: 600;">
      ${title}
    </h3>
    ${items.map(item => `
      <p style="margin: 4px 0; color: ${colors.gray600}; font-size: 13px;">
        <strong>${item.label}:</strong> ${item.value}
      </p>
    `).join('')}
  </div>
`;

// Formata valor em Real
const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
};

// Formata data
const formatDate = (date: Date | string) => {
  return new Date(date).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// Interface para dados do pedido
interface OrderData {
  orderNumber: string;
  buyerName: string;
  buyerEmail: string;
  broadcasterName: string;
  broadcasterEmail: string;
  totalValue: number;
  itemsCount: number;
  createdAt: Date | string;
}

// ===========================================
// EMAILS PARA EMISSORA
// ===========================================

/**
 * Email para emissora quando recebe novo pedido
 */
export const sendNewOrderToBroadcaster = async (order: OrderData) => {
  const content = `
    ${greeting(order.broadcasterName)}
    
    ${paragraph(`O anunciante <strong>${order.buyerName}</strong> fez um pedido de veiculação na sua emissora! 🎉`)}
    
    ${infoCard('Resumo do Pedido', [
    { label: 'Pedido', value: order.orderNumber },
    { label: 'Anunciante', value: order.buyerName },
    { label: 'Valor', value: formatCurrency(order.totalValue) },
    { label: 'Inserções', value: `${order.itemsCount}` },
    { label: 'Data', value: formatDate(order.createdAt) }
  ], colors.tertiary)}
    
    ${alertCard('Você tem <strong>48 horas</strong> para aprovar ou recusar este pedido. Pedidos não aprovados são cancelados automaticamente.', 'warning')}
    
    ${paragraph('Acesse a plataforma para ver os detalhes completos e aprovar o pedido.', { center: true })}
  `;

  await sendEmail({
    to: order.broadcasterEmail,
    subject: `🔔 Novo Pedido #${order.orderNumber} - E-rádios`,
    html: createEmailTemplate({
      title: 'Novo Pedido Recebido!',
      subtitle: `Pedido #${order.orderNumber}`,
      icon: '📻',
      content,
      buttonText: 'Ver Pedido e Aprovar',
      buttonUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/broadcaster/orders`,
      buttonColor: colors.tertiary,
      preheader: `Novo pedido de ${order.buyerName} - ${formatCurrency(order.totalValue)}`
    })
  });
};

// ===========================================
// EMAILS PARA ANUNCIANTE/COMPRADOR
// ===========================================

/**
 * Email de confirmação de compra para o cliente
 * Enviado quando o pagamento é confirmado
 */
export const sendOrderConfirmationToClient = async (data: {
  orderNumber: string;
  buyerName: string;
  buyerEmail: string;
  items: Array<{
    productName: string;
    broadcasterName: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }>;
  subtotal: number;
  techFee: number;
  totalAmount: number;
  paymentMethod: string;
  createdAt: Date | string;
}) => {
  const subject = `🎉 Compra confirmada - Pedido #${data.orderNumber}`;

  // Gera a lista de itens
  const itemsList = data.items.map(item => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid ${colors.gray100};">
        <strong>${item.productName}</strong><br>
        <span style="color: ${colors.gray600}; font-size: 12px;">${item.broadcasterName}</span>
      </td>
      <td style="padding: 12px; border-bottom: 1px solid ${colors.gray100}; text-align: center;">
        ${item.quantity}
      </td>
      <td style="padding: 12px; border-bottom: 1px solid ${colors.gray100}; text-align: right;">
        ${formatCurrency(item.totalPrice)}
      </td>
    </tr>
  `).join('');

  const paymentMethodText = {
    'credit_card': '💳 Cartão de Crédito',
    'pix': '📱 PIX',
    'wallet': '💰 Créditos da Wallet',
    'billing': '📄 Faturamento'
  }[data.paymentMethod] || data.paymentMethod;

  const content = `
    <div style="text-align: center; margin-bottom: 24px;">
      <span style="font-size: 48px;">🎉</span>
    </div>
    
    <h2 style="margin: 0 0 16px; color: ${colors.success}; font-size: 20px; text-align: center;">
      Compra Confirmada!
    </h2>
    
    <p style="margin: 0 0 16px; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
      Olá <strong>${data.buyerName}</strong>,
    </p>
    
    <p style="margin: 0 0 24px; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
      Recebemos seu pedido e o pagamento foi confirmado! Agora as emissoras têm até <strong>48 horas</strong> para aprovar sua campanha.
    </p>
    
    <div style="background-color: ${colors.gray100}; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
      <h3 style="margin: 0 0 16px; color: ${colors.gray800}; font-size: 16px;">
        📋 Detalhes do Pedido #${data.orderNumber}
      </h3>
      
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size: 14px;">
        <thead>
          <tr style="background-color: ${colors.primary}; color: ${colors.white};">
            <th style="padding: 10px; text-align: left; border-radius: 4px 0 0 4px;">Produto</th>
            <th style="padding: 10px; text-align: center;">Qtd</th>
            <th style="padding: 10px; text-align: right; border-radius: 0 4px 4px 0;">Valor</th>
          </tr>
        </thead>
        <tbody>
          ${itemsList}
        </tbody>
      </table>
      
      <div style="margin-top: 16px; padding-top: 16px; border-top: 2px solid ${colors.gray100};">
        <table width="100%" style="font-size: 14px;">
          <tr>
            <td style="color: ${colors.gray600};">Subtotal</td>
            <td style="text-align: right;">${formatCurrency(data.subtotal)}</td>
          </tr>
          <tr>
            <td style="color: ${colors.gray600};">Taxa da Plataforma (25%)</td>
            <td style="text-align: right;">${formatCurrency(data.techFee)}</td>
          </tr>
          <tr style="font-size: 16px; font-weight: bold;">
            <td style="color: ${colors.gray800}; padding-top: 8px;">Total</td>
            <td style="text-align: right; color: ${colors.success}; padding-top: 8px;">${formatCurrency(data.totalAmount)}</td>
          </tr>
        </table>
      </div>
    </div>
    
    <div style="background-color: ${colors.primary}15; border-left: 4px solid ${colors.primary}; padding: 12px 16px; margin-bottom: 24px;">
      <p style="margin: 0; color: ${colors.gray800}; font-size: 14px;">
        <strong>Forma de Pagamento:</strong> ${paymentMethodText}
      </p>
      <p style="margin: 4px 0 0; color: ${colors.gray600}; font-size: 12px;">
        Data: ${formatDate(data.createdAt)}
      </p>
    </div>
    
    <h3 style="margin: 0 0 12px; color: ${colors.gray800}; font-size: 16px;">
      📌 Próximos Passos
    </h3>
    
    <ol style="margin: 0 0 24px; padding-left: 20px; color: ${colors.gray600}; font-size: 14px; line-height: 1.8;">
      <li>As emissoras vão analisar seu pedido (até 48h)</li>
      <li>Você receberá um email quando cada emissora aprovar</li>
      <li>Sua campanha será veiculada conforme agendado</li>
      <li>Ao final, você receberá os comprovantes de veiculação</li>
    </ol>
    
    ${buttonComponent('Acompanhar Pedido', `${process.env.FRONTEND_URL || 'http://localhost:3000'}/my-campaigns`)}
    
    <p style="margin: 24px 0 0; color: ${colors.gray600}; font-size: 13px; text-align: center;">
      Obrigado por escolher a E-rádios! 🎙️
    </p>
  `;

  await sendEmail({
    to: data.buyerEmail,
    subject,
    html: emailTemplate(content, `Pedido #${data.orderNumber} confirmado - ${formatCurrency(data.totalAmount)}`)
  });
};

/**
 * Email para cliente quando pedido é aprovado
 */
export const sendOrderApprovedToClient = async (order: OrderData) => {
  const content = `
    ${greeting(order.buyerName)}
    
    ${paragraph(`A emissora <strong>${order.broadcasterName}</strong> aprovou seu pedido de veiculação! 🎉`)}
    
    ${paragraph('Sua campanha está confirmada e será veiculada conforme o agendamento.')}
    
    ${infoCard('Detalhes do Pedido', [
    { label: 'Pedido', value: order.orderNumber },
    { label: 'Emissora', value: order.broadcasterName },
    { label: 'Valor', value: formatCurrency(order.totalValue) },
    { label: 'Status', value: '✅ Aprovado' }
  ], colors.success)}
    
    ${alertCard('Sua campanha será veiculada conforme agendado. Você receberá o comprovante após a veiculação.', 'success')}
  `;

  await sendEmail({
    to: order.buyerEmail,
    subject: `✅ Pedido #${order.orderNumber} Aprovado - E-rádios`,
    html: createEmailTemplate({
      title: 'Pedido Aprovado!',
      subtitle: `Pedido #${order.orderNumber}`,
      icon: '✅',
      content,
      buttonText: 'Ver Campanha',
      buttonUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/campaigns/${order.orderNumber}`,
      buttonColor: colors.tertiary,
      preheader: `Sua campanha na ${order.broadcasterName} foi confirmada!`
    })
  });
};

/**
 * Email para cliente quando pedido é recusado
 */
export const sendOrderRejectedToClient = async (order: OrderData & { reason: string }) => {
  const content = `
    ${greeting(order.buyerName)}
    
    ${paragraph(`Infelizmente, a emissora <strong>${order.broadcasterName}</strong> não pôde aprovar seu pedido.`)}
    
    ${infoCard('Motivo da Recusa', [
    { label: 'Razão', value: order.reason }
  ], colors.error)}
    
    ${infoCard('Detalhes do Pedido', [
    { label: 'Pedido', value: order.orderNumber },
    { label: 'Emissora', value: order.broadcasterName },
    { label: 'Valor', value: formatCurrency(order.totalValue) }
  ], colors.gray600)}
    
    ${alertCard(`<strong>Boa notícia!</strong> O valor de ${formatCurrency(order.totalValue)} foi estornado para sua carteira na plataforma.`, 'success')}
  `;

  await sendEmail({
    to: order.buyerEmail,
    subject: `❌ Pedido #${order.orderNumber} Recusado - E-rádios`,
    html: createEmailTemplate({
      title: 'Pedido Não Aprovado',
      subtitle: `Pedido #${order.orderNumber}`,
      icon: '❌',
      content,
      buttonText: 'Buscar Outras Emissoras',
      buttonUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/marketplace`,
      buttonColor: colors.tertiary,
      preheader: `Seu pedido na ${order.broadcasterName} foi recusado. Valor estornado.`
    })
  });
};

/**
 * Email para cliente quando pedido é cancelado (expirado SLA)
 */
export const sendOrderCancelledToClient = async (order: OrderData & { cancelReason: string }) => {
  const content = `
    ${greeting(order.buyerName)}
    
    ${paragraph(`Seu pedido na emissora <strong>${order.broadcasterName}</strong> foi cancelado.`)}
    
    ${infoCard('Motivo do Cancelamento', [
    { label: 'Razão', value: order.cancelReason }
  ], colors.warning)}
    
    ${infoCard('Detalhes do Pedido', [
    { label: 'Pedido', value: order.orderNumber },
    { label: 'Emissora', value: order.broadcasterName },
    { label: 'Valor', value: formatCurrency(order.totalValue) }
  ], colors.gray600)}
    
    ${alertCard(`O valor de ${formatCurrency(order.totalValue)} foi estornado para sua carteira.`, 'success')}
  `;

  await sendEmail({
    to: order.buyerEmail,
    subject: `⚠️ Pedido #${order.orderNumber} Cancelado - E-rádios`,
    html: createEmailTemplate({
      title: 'Pedido Cancelado',
      subtitle: `Pedido #${order.orderNumber}`,
      icon: '⚠️',
      content,
      buttonText: 'Buscar Outras Emissoras',
      buttonUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/marketplace`,
      buttonColor: colors.tertiary,
      preheader: 'Pedido cancelado. Valor estornado para sua carteira.'
    })
  });
};

// ===========================================
// FUNÇÃO PRINCIPAL DE ENVIO
// ===========================================

// ===========================================
// FUNÇÃO PRINCIPAL DE ENVIO
// ===========================================

interface EmailParams {
  to: string;
  subject: string;
  html: string;
}

const sendEmail = async ({ to, subject, html }: EmailParams) => {
  const from = process.env.SMTP_FROM || 'E-rádios <noreply@E-rádios.com>';

  // Se não há transporter (desenvolvimento), apenas loga
  if (!transporter) {
    return { success: true, mode: 'development' };
  }

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      html
    });


    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    // Não propaga o erro - email não deve bloquear operações
    return { success: false, error: error.message };
  }
};

// ===========================================
// TEMPLATE SIMPLIFICADO (SOLICITAÇÃO DE COTAÇÃO)
// ===========================================

/**
 * Cria um template de email limpo e direto
 * Fundo branco, cores da marca (rosa/roxo), sem imagens pesadas
 */
const createSimpleEmailTemplate = (title: string, content: string): string => {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #ffffff; color: #333333; line-height: 1.6;">
  
  <!-- Container Principal -->
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    
    <!-- Header -->
    <div style="margin-bottom: 30px; border-bottom: 2px solid ${colors.tertiary}; padding-bottom: 20px;">
      <h1 style="margin: 0; color: ${colors.tertiary}; font-size: 24px; font-weight: 700;">${title}</h1>
    </div>

    <!-- Conteúdo -->
    <div style="font-size: 16px; color: #444444;">
      ${content}
    </div>

    <!-- Footer Simples -->
    <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eeeeee; font-size: 12px; color: #888888; text-align: center;">
      <p style="margin: 0;">© ${new Date().getFullYear()} E-rádios - Tecnologia em Publicidade</p>
      <p style="margin: 5px 0 0;"><a href="${process.env.FRONTEND_URL}" style="color: ${colors.tertiary}; text-decoration: none;">Acessar Plataforma</a></p>
    </div>

  </div>
</body>
</html>
  `;
};

// ===========================================
// NOVOS EMAILS DE FLUXO DE PEDIDO (SIMPLE)
// ===========================================

/**
 * Email para o cliente confirmando recebimento do pedido (Cotação/Contato)
 */
export const sendOrderReceivedToClient = async (order: {
  orderNumber: string,
  buyerName: string,
  buyerEmail: string,
  items: Array<{ productName: string, broadcasterName: string }>,
  totalValue: number
}) => {
  const itemList = order.items.map(i => `<li style="margin-bottom: 5px;"><strong>${i.productName}</strong> na ${i.broadcasterName}</li>`).join('');

  const content = `
    <p>Olá, <strong>${order.buyerName}</strong>.</p>
    
    <p>Obrigado por sua solicitação! Recebemos seu pedido <strong>#${order.orderNumber}</strong> com sucesso.</p>

    <div style="background-color: #f9f9f9; border-radius: 8px; padding: 20px; margin: 25px 0;">
      <h3 style="margin-top: 0; color: ${colors.secondary}; font-size: 18px;">Resumo da Solicitação</h3>
      <ul style="padding-left: 20px; color: #555;">
        ${itemList}
      </ul>
      <p style="margin-bottom: 0; font-weight: bold; color: ${colors.gray800};">Valor Total Estimado: ${formatCurrency(order.totalValue)}</p>
    </div>

    <p><strong>Próximos Passos:</strong></p>
    <p>Nossa equipe comercial já foi notificada e entrará em contato com você em breve para alinhar os detalhes, materiais e pagamento.</p>
    
    <p>Você pode acompanhar o status em sua área de campanhas.</p>

    <div style="margin-top: 30px;">
      <a href="${process.env.FRONTEND_URL}/campaigns" style="display: inline-block; background-color: ${colors.tertiary}; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600;">Acompanhar Pedido</a>
    </div>
    
    <p style="margin-top: 30px;">Atenciosamente,<br>Equipe E-rádios</p>
  `;

  await sendEmail({
    to: order.buyerEmail,
    subject: `Pedido #${order.orderNumber} Recebido - E-rádios`,
    html: createSimpleEmailTemplate('Solicitação Recebida!', content)
  });
};

/**
 * Email de notificação para Admin sobre novo pedido
 */
export const sendNewOrderToAdmin = async (order: {
  orderNumber: string,
  buyerName: string,
  buyerEmail: string,
  buyerPhone: string,
  totalValue: number,
  itemsCount: number,
  adminEmails: string[],
  isMonitoringEnabled?: boolean
}) => {
  if (!order.adminEmails || order.adminEmails.length === 0) return;

  const monitoringBadge = order.isMonitoringEnabled
    ? `<span style="display:inline-block; padding: 2px 8px; background-color: ${colors.success}; color: #fff; border-radius: 4px; font-size: 11px; margin-left: 8px;">Monitoramento Ativo</span>`
    : '';

  const content = `
    <p>👋 Olá Admin,</p>
    
    <p>Um novo pedido foi gerado na plataforma e requer atenção da equipe comercial.</p>

    <div style="border: 1px solid #eee; border-radius: 8px; padding: 20px; margin: 20px 0;">
      <p style="margin: 5px 0;"><strong>Pedido:</strong> <span style="color: ${colors.tertiary}; font-weight: bold;">#${order.orderNumber}</span></p>
      <p style="margin: 5px 0;"><strong>Cliente:</strong> ${order.buyerName}</p>
      <p style="margin: 5px 0;"><strong>Email:</strong> ${order.buyerEmail}</p>
      <p style="margin: 5px 0;"><strong>Telefone:</strong> ${order.buyerPhone || 'Não informado'}</p>
      <p style="margin: 5px 0;"><strong>Itens:</strong> ${order.itemsCount}</p>
      <p style="margin: 5px 0;"><strong>Valor Total:</strong> ${formatCurrency(order.totalValue)} ${monitoringBadge}</p>
    </div>

    <p style="color: ${colors.error}; font-weight: 600;">Ação Necessária: Entrar em contato com o cliente.</p>

    <div style="margin-top: 25px;">
      <a href="${process.env.FRONTEND_URL}/admin/orders" style="display: inline-block; background-color: ${colors.secondary}; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 5px; font-weight: 600; font-size: 14px;">Gerenciar Pedidos</a>
    </div>
  `;

  // Envia para todos os admins
  for (const email of order.adminEmails) {
    await sendEmail({
      to: email,
      subject: `🔔 Novo Pedido #${order.orderNumber} (R$ ${order.totalValue.toLocaleString('pt-BR')})`,
      html: createSimpleEmailTemplate('Novo Pedido na Plataforma', content)
    });
  }
};

// ===========================================
// EMAILS DE MATERIAL (CHAT)
// ===========================================

/**
 * Email para cliente quando emissora rejeita material
 */
export const sendMaterialRejectedByBroadcaster = async (data: {
  clientEmail: string;
  clientName: string;
  orderNumber: string;
  broadcasterName: string;
  reason: string;
}) => {
  const subject = `⚠️ Material precisa ser revisado - Pedido #${data.orderNumber}`;

  const content = `
    <h2 style="margin: 0 0 16px; color: ${colors.warning}; font-size: 20px;">
      Material precisa ser ajustado
    </h2>
    
    <p style="margin: 0 0 16px; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
      Olá <strong>${data.clientName}</strong>,
    </p>
    
    <p style="margin: 0 0 16px; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
      A emissora <strong>${data.broadcasterName}</strong> revisou o material do seu pedido e solicitou algumas alterações.
    </p>
    
    <div style="background-color: #FFFBEB; border-left: 4px solid ${colors.warning}; padding: 12px 16px; margin: 16px 0; border-radius: 0 6px 6px 0;">
      <p style="margin: 0; color: ${colors.gray800}; font-size: 13px;">
        <strong>Observações da emissora:</strong><br>${data.reason}
      </p>
    </div>
    
    <p style="margin: 16px 0; color: ${colors.gray600}; font-size: 14px;">
      Acesse o chat do pedido para conversar com a emissora e enviar o material corrigido.
    </p>
    
    ${buttonComponent('Acessar Chat', `${process.env.FRONTEND_URL || 'http://localhost:3000'}/orders/${data.orderNumber}`, colors.warning)}
    
    <p style="margin: 16px 0 0; color: ${colors.error}; font-size: 12px;">
      ⏰ Este processo precisa ser concluído em até 24 horas.
    </p>
  `;

  await sendEmail({
    to: data.clientEmail,
    subject,
    html: emailTemplate(content, `Material do pedido ${data.orderNumber} precisa de ajustes`)
  });
};

/**
 * Email para cliente quando emissora envia produção própria
 */
export const sendMaterialProducedByBroadcaster = async (data: {
  clientEmail: string;
  clientName: string;
  orderNumber: string;
  broadcasterName: string;
  audioUrl: string;
  notes: string;
}) => {
  const subject = `🎙️ Áudio produzido aguarda aprovação - Pedido #${data.orderNumber}`;

  const content = `
    <h2 style="margin: 0 0 16px; color: ${colors.primary}; font-size: 20px;">
      Sua locução está pronta!
    </h2>
    
    <p style="margin: 0 0 16px; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
      Olá <strong>${data.clientName}</strong>,
    </p>
    
    <p style="margin: 0 0 16px; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
      A emissora <strong>${data.broadcasterName}</strong> produziu e gravou o comercial do seu pedido.
      Ouça e aprove para liberar a veiculação.
    </p>
    
    ${data.notes ? `
    <div style="background-color: ${colors.gray100}; border-radius: 6px; padding: 12px 16px; margin: 16px 0;">
      <p style="margin: 0; color: ${colors.gray800}; font-size: 13px;">
        <strong>Observações:</strong><br>${data.notes}
      </p>
    </div>
    ` : ''}
    
    <div style="background-color: #EFF6FF; border-radius: 6px; padding: 16px; margin: 16px 0; text-align: center;">
      <p style="margin: 0 0 12px; color: ${colors.gray800}; font-size: 14px;">
        🎧 <strong>Ouça o áudio produzido:</strong>
      </p>
      <a href="${data.audioUrl}" style="display: inline-block; background-color: ${colors.primary}; color: ${colors.white}; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 13px;">
        ▶️ Reproduzir Áudio
      </a>
    </div>
    
    ${buttonComponent('Aprovar/Reprovar Material', `${process.env.FRONTEND_URL || 'http://localhost:3000'}/orders/${data.orderNumber}`)}
    
    <p style="margin: 16px 0 0; color: ${colors.error}; font-size: 12px;">
      ⏰ Por favor, aprove ou solicite alterações em até 24 horas.
    </p>
  `;

  await sendEmail({
    to: data.clientEmail,
    subject,
    html: emailTemplate(content, `${data.broadcasterName} enviou a produção do seu comercial`)
  });
};

/**
 * Email para emissora quando cliente aprova material
 */
export const sendMaterialApprovedByClient = async (data: {
  broadcasterEmail: string;
  broadcasterName: string;
  orderNumber: string;
  clientName: string;
}) => {
  const subject = `✅ Material aprovado pelo cliente - Pedido #${data.orderNumber}`;

  const content = `
    <div style="text-align: center; margin-bottom: 24px;">
      <span style="font-size: 48px;">✅</span>
    </div>
    
    <h2 style="margin: 0 0 16px; color: ${colors.success}; font-size: 20px; text-align: center;">
      Material aprovado!
    </h2>
    
    <p style="margin: 0 0 16px; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
      O cliente <strong>${data.clientName}</strong> aprovou o material do pedido #${data.orderNumber}.
    </p>
    
    <p style="margin: 0 0 16px; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
      O comercial está liberado para veiculação conforme o agendamento.
    </p>
    
    ${buttonComponent('Ver Pedido', `${process.env.FRONTEND_URL || 'http://localhost:3000'}/broadcaster/orders`)}
  `;

  await sendEmail({
    to: data.broadcasterEmail,
    subject,
    html: emailTemplate(content, `Material aprovado pelo cliente`)
  });
};

/**
 * Email para emissora quando cliente rejeita material
 */
export const sendMaterialRejectedByClient = async (data: {
  broadcasterEmail: string;
  broadcasterName: string;
  orderNumber: string;
  clientName: string;
  reason: string;
}) => {
  const subject = `⚠️ Cliente solicitou ajustes - Pedido #${data.orderNumber}`;

  const content = `
    <h2 style="margin: 0 0 16px; color: ${colors.warning}; font-size: 20px;">
      Material precisa ser revisado
    </h2>
    
    <p style="margin: 0 0 16px; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
      O cliente <strong>${data.clientName}</strong> solicitou alterações no material do pedido #${data.orderNumber}.
    </p>
    
    <div style="background-color: #FFFBEB; border-left: 4px solid ${colors.warning}; padding: 12px 16px; margin: 16px 0; border-radius: 0 6px 6px 0;">
      <p style="margin: 0; color: ${colors.gray800}; font-size: 13px;">
        <strong>Solicitação do cliente:</strong><br>${data.reason}
      </p>
    </div>
    
    <p style="margin: 16px 0; color: ${colors.gray600}; font-size: 14px;">
      Acesse o chat do pedido para conversar com o cliente e enviar a versão revisada.
    </p>
    
    ${buttonComponent('Acessar Chat', `${process.env.FRONTEND_URL || 'http://localhost:3000'}/broadcaster/orders`, colors.warning)}
    
    <p style="margin: 16px 0 0; color: ${colors.error}; font-size: 12px;">
      ⏰ Este processo precisa ser concluído em até 24 horas.
    </p>
  `;

  await sendEmail({
    to: data.broadcasterEmail,
    subject,
    html: emailTemplate(content, `Cliente solicitou ajustes no material`)
  });
};

// ===========================================
// EMAILS DE FATURAMENTO
// ===========================================

/**
 * Email para cliente após escolher "A Faturar"
 */
export const sendBillingPendingValidation = async (data: {
  clientEmail: string;
  clientName: string;
  orderNumber: string;
  totalValue: number;
}) => {
  const subject = `📋 Pedido #${data.orderNumber} - Aguardando Validação`;

  const content = `
    <div style="text-align: center; margin-bottom: 24px;">
      <span style="font-size: 48px;">📋</span>
    </div>
    
    <h2 style="margin: 0 0 16px; color: ${colors.primary}; font-size: 20px; text-align: center;">
      Pedido Recebido!
    </h2>
    
    <p style="margin: 0 0 16px; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
      Olá <strong>${data.clientName}</strong>,
    </p>
    
    <p style="margin: 0 0 16px; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
      Recebemos sua solicitação de faturamento para a campanha <strong>#${data.orderNumber}</strong>.
    </p>
    
    <div style="background-color: #EFF6FF; border-left: 4px solid ${colors.primary}; padding: 16px; margin: 16px 0; border-radius: 0 6px 6px 0;">
      <p style="margin: 0; color: ${colors.gray800}; font-size: 14px; line-height: 1.6;">
        <strong>Nossa equipe está validando os dados da campanha e do faturamento.</strong><br>
        Você receberá um e-mail quando tudo for confirmado.
      </p>
    </div>
    
    ${infoBox('Resumo', [
    { label: 'Pedido', value: data.orderNumber },
    { label: 'Valor Total', value: formatCurrency(data.totalValue) }
  ])}
    
    <p style="margin: 16px 0 0; color: ${colors.gray600}; font-size: 14px;">
      Após a aprovação, sua campanha seguirá para aceite das emissoras.
    </p>
  `;

  await sendEmail({
    to: data.clientEmail,
    subject,
    html: emailTemplate(content, `Pedido ${data.orderNumber} em validação`)
  });
};

/**
 * Email para admin quando novo pedido "A Faturar" é criado
 */
export const sendBillingAdminNotification = async (data: {
  orderNumber: string;
  clientName: string;
  totalValue: number;
  adminEmail: string;
}) => {
  const subject = `⚠️ [ADMIN] Novo pedido A Faturar - #${data.orderNumber}`;

  const content = `
    <div style="text-align: center; margin-bottom: 24px;">
      <span style="font-size: 48px;">⚠️</span>
    </div>
    
    <h2 style="margin: 0 0 16px; color: ${colors.error}; font-size: 20px; text-align: center;">
      Novo Pedido A Faturar
    </h2>
    
    <p style="margin: 0 0 16px; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
      Um novo pedido com opção "A Faturar" foi criado e precisa de validação:
    </p>
    
    <div style="background-color: #FEF2F2; border-left: 4px solid ${colors.error}; padding: 16px; margin: 16px 0; border-radius: 0 6px 6px 0;">
      ${infoBox('Pedido Pendente', [
    { label: 'Número', value: data.orderNumber },
    { label: 'Cliente', value: data.clientName },
    { label: 'Valor', value: formatCurrency(data.totalValue) }
  ])}
    </div>
    
    ${buttonComponent('Validar Pedido', `${process.env.FRONTEND_URL}/admin/billing`, colors.error)}
    
    <p style="margin: 16px 0 0; color: ${colors.gray600}; font-size: 13px;">
      Acesse o painel administrativo para aprovar ou recusar este pedido.
    </p>
  `;

  await sendEmail({
    to: data.adminEmail,
    subject,
    html: emailTemplate(content, `Novo pedido A Faturar aguardando validação`)
  });
};

/**
 * Email para cliente quando pedido "A Faturar" é aprovado
 */
export const sendBillingApproved = async (data: {
  clientEmail: string;
  clientName: string;
  orderNumber: string;
  totalValue: number;
}) => {
  const subject = `✅ Pedido #${data.orderNumber} Aprovado!`;

  const content = `
    <div style="text-align: center; margin-bottom: 24px;">
      <span style="font-size: 48px;">✅</span>
    </div>
    
    <h2 style="margin: 0 0 16px; color: ${colors.success}; font-size: 20px; text-align: center;">
      Pedido Aprovado!
    </h2>
    
    <p style="margin: 0 0 16px; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
      Olá <strong>${data.clientName}</strong>,
    </p>
    
    <p style="margin: 0 0 16px; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
      Seu pedido <strong>#${data.orderNumber}</strong> foi aprovado!
    </p>
    
    <div style="background-color: #ECFDF5; border-left: 4px solid ${colors.success}; padding: 16px; margin: 16px 0; border-radius: 0 6px 6px 0;">
      ${infoBox('Pedido Aprovado', [
    { label: 'Número', value: data.orderNumber },
    { label: 'Valor', value: formatCurrency(data.totalValue) },
    { label: 'Vencimento', value: 'Dia 15 do mês seguinte à veiculação' }
  ])}
    </div>
    
    <p style="margin: 16px 0; color: ${colors.gray600}; font-size: 14px;">
      Agora sua campanha está seguindo para aceite das emissoras. Você receberá atualizações por e-mail.
    </p>
    
    ${buttonComponent('Acompanhar Campanha', `${process.env.FRONTEND_URL}/campaigns/${data.orderNumber}`)}
  `;

  await sendEmail({
    to: data.clientEmail,
    subject,
    html: emailTemplate(content, `Pedido ${data.orderNumber} aprovado para faturamento`)
  });
};

/**
 * Email para cliente quando pedido "A Faturar" é recusado
 */
export const sendBillingRejected = async (data: {
  clientEmail: string;
  clientName: string;
  orderNumber: string;
  reason: string;
}) => {
  const subject = `❌ Pedido #${data.orderNumber} Não Aprovado`;

  const content = `
    <div style="text-align: center; margin-bottom: 24px;">
      <span style="font-size: 48px;">❌</span>
    </div>
    
    <h2 style="margin: 0 0 16px; color: ${colors.error}; font-size: 20px; text-align: center;">
      Pedido Não Aprovado
    </h2>
    
    <p style="margin: 0 0 16px; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
      Olá <strong>${data.clientName}</strong>,
    </p>
    
    <p style="margin: 0 0 16px; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
      Infelizmente não foi possível aprovar seu pedido <strong>#${data.orderNumber}</strong> para faturamento.
    </p>
    
    <div style="background-color: #FEF2F2; border-left: 4px solid ${colors.error}; padding: 16px; margin: 16px 0; border-radius: 0 6px 6px 0;">
      <p style="margin: 0; color: ${colors.gray800}; font-size: 14px;">
        <strong>Motivo:</strong><br>${data.reason}
      </p>
    </div>
    
    <p style="margin: 16px 0; color: ${colors.gray600}; font-size: 14px;">
      Por favor, entre em contato conosco para mais informações ou escolha outra forma de pagamento (PIX ou Crédito).
    </p>
    
    ${buttonComponent('Falar com Suporte', `${process.env.FRONTEND_URL}/support`)}
  `;

  await sendEmail({
    to: data.clientEmail,
    subject,
    html: emailTemplate(content, `Pedido ${data.orderNumber} não aprovado para faturamento`)
  });
};

/**
 * Email para cliente após veiculação com fatura emitida
 */
export const sendInvoiceIssued = async (data: {
  clientEmail: string;
  clientName: string;
  orderNumber: string;
  totalValue: number;
  dueDate: string;
  boletoUrl?: string;
}) => {
  const subject = `📋 Fatura #${data.orderNumber} Emitida - Vencimento ${data.dueDate}`;

  const content = `
    <div style="text-align: center; margin-bottom: 24px;">
      <span style="font-size: 48px;">📋</span>
    </div>
    
    <h2 style="margin: 0 0 16px; color: ${colors.primary}; font-size: 20px; text-align: center;">
      Fatura Emitida
    </h2>
    
    <p style="margin: 0 0 16px; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
      Olá <strong>${data.clientName}</strong>,
    </p>
    
    <p style="margin: 0 0 16px; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
      Sua campanha <strong>#${data.orderNumber}</strong> foi veiculada com sucesso!
    </p>
    
    <div style="background-color: #EFF6FF; border-left: 4px solid ${colors.primary}; padding: 16px; margin: 16px 0; border-radius: 0 6px 6px 0;">
      ${infoBox('Fatura', [
    { label: 'Número', value: data.orderNumber },
    { label: 'Valor', value: formatCurrency(data.totalValue) },
    { label: 'Vencimento', value: data.dueDate }
  ])}
    </div>
    
    ${data.boletoUrl ? buttonComponent('Baixar Boleto', data.boletoUrl) : ''}
    
    <p style="margin: 16px 0 0; color: ${colors.error}; font-size: 13px;">
      ⚠️ Por favor, efetue o pagamento até a data de vencimento para evitar multa (2%) e juros (1% ao mês).
    </p>
  `;

  await sendEmail({
    to: data.clientEmail,
    subject,
    html: emailTemplate(content, `Fatura ${data.orderNumber} emitida - Vence ${data.dueDate}`)
  });
};

/**
 * Email de lembrete de vencimento (3 dias antes)
 */
export const sendPaymentReminder = async (data: {
  clientEmail: string;
  clientName: string;
  orderNumber: string;
  totalValue: number;
  dueDate: string;
  boletoUrl?: string;
}) => {
  const subject = `⏰ Lembrete: Fatura #${data.orderNumber} vence em ${data.dueDate}`;

  const content = `
    <div style="text-align: center; margin-bottom: 24px;">
      <span style="font-size: 48px;">⏰</span>
    </div>
    
    <h2 style="margin: 0 0 16px; color: ${colors.warning}; font-size: 20px; text-align: center;">
      Lembrete de Pagamento
    </h2>
    
    <p style="margin: 0 0 16px; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
      Olá <strong>${data.clientName}</strong>,
    </p>
    
    <p style="margin: 0 0 16px; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
      Este é um lembrete de que a fatura <strong>#${data.orderNumber}</strong> vence em breve:
    </p>
    
    <div style="background-color: #FFFBEB; border-left: 4px solid ${colors.warning}; padding: 16px; margin: 16px 0; border-radius: 0 6px 6px 0;">
      ${infoBox('Fatura Pendente', [
    { label: 'Número', value: data.orderNumber },
    { label: 'Valor', value: formatCurrency(data.totalValue) },
    { label: 'Vencimento', value: data.dueDate }
  ])}
    </div>
    
    ${data.boletoUrl ? buttonComponent('Baixar Boleto', data.boletoUrl, colors.warning) : ''}
    
    <p style="margin: 16px 0 0; color: ${colors.error}; font-size: 13px;">
      ⚠️ Pagamento em atraso gera multa de 2% + juros de 1% ao mês.
    </p>
  `;

  await sendEmail({
    to: data.clientEmail,
    subject,
    html: emailTemplate(content, `Fatura ${data.orderNumber} vence em breve`)
  });
};

/**
 * Email para emissora solicitando NF até dia 20
 */
export const sendBroadcasterInvoiceRequest = async (data: {
  broadcasterEmail: string;
  broadcasterName: string;
  orderNumber: string;
  broadcasterValue: number;
  dueDate: string;
}) => {
  const subject = `📄 Emitir NF - Campanha #${data.orderNumber}`;

  const content = `
    <div style="text-align: center; margin-bottom: 24px;">
      <span style="font-size: 48px;">📄</span>
    </div>
    
    <h2 style="margin: 0 0 16px; color: ${colors.secondary}; font-size: 20px; text-align: center;">
      Emitir Nota Fiscal
    </h2>
    
    <p style="margin: 0 0 16px; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
      Olá <strong>${data.broadcasterName}</strong>,
    </p>
    
    <p style="margin: 0 0 16px; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
      A campanha <strong>#${data.orderNumber}</strong> foi concluída. Por favor, emita a nota fiscal de <strong>80%</strong> do valor:
    </p>
    
    <div style="background-color: #F3E8FF; border-left: 4px solid ${colors.secondary}; padding: 16px; margin: 16px 0; border-radius: 0 6px 6px 0;">
      ${infoBox('Dados da Nota Fiscal', [
    { label: 'Campanha', value: data.orderNumber },
    { label: 'Valor a Faturar (80%)', value: formatCurrency(data.broadcasterValue) },
    { label: 'Prazo de Envio', value: 'Até dia 20' },
    { label: 'Vencimento do Pagamento', value: data.dueDate }
  ])}
    </div>
    
    ${buttonComponent('Acessar Financeiro', `${process.env.FRONTEND_URL}/broadcaster/financial`, colors.secondary)}
    
    <p style="margin: 16px 0 0; color: ${colors.error}; font-size: 13px;">
      ⚠️ <strong>Importante:</strong> A nota fiscal deve ser enviada até o dia 20 para garantir o pagamento no prazo (${data.dueDate}).
    </p>
  `;

  await sendEmail({
    to: data.broadcasterEmail,
    subject,
    html: emailTemplate(content, `Emitir NF para campanha ${data.orderNumber}`)
  });
};

/**
 * Email para emissora quando admin aprova pedido "A Faturar"
 * Inclui dados de faturamento da PLATAFORMA para emissora emitir NF CONTRA plataforma
 */
export const sendBillingOrderToBroadcaster = async (data: {
  broadcasterEmail: string;
  broadcasterName: string;
  orderNumber: string;
  broadcasterValue: number;
  platformBillingData: {
    razaoSocial: string;
    cnpj: string;
    address: string;
    email: string;
    phone: string;
  };
  startDate: string;
  endDate: string;
}) => {
  const subject = `✅ Pedido #${data.orderNumber} Aprovado - Emitir NF Contra Plataforma`;

  const content = `
    <div style="text-align: center; margin-bottom: 24px;">
      <span style="font-size: 48px;">✅</span>
    </div>
    
    <h2 style="margin: 0 0 16px; color: ${colors.success}; font-size: 20px; text-align: center;">
      Pedido Aprovado - A Faturar
    </h2>
    
    <p style="margin: 0 0 16px; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
      Olá <strong>${data.broadcasterName}</strong>,
    </p>
    
    <p style="margin: 0 0 16px; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
      O pedido <strong>#${data.orderNumber}</strong> foi aprovado pela administração e a campanha já pode ser veiculada!
    </p>
    
    <div style="background-color: #ECFDF5; border-left: 4px solid ${colors.success}; padding: 16px; margin: 16px 0; border-radius: 0 6px 6px 0;">
      ${infoBox('Dados da Campanha', [
    { label: 'Pedido', value: data.orderNumber },
    { label: 'Período', value: `${data.startDate} até ${data.endDate}` },
    { label: 'Seu Valor (80%)', value: formatCurrency(data.broadcasterValue) }
  ])}
    </div>
    
    <div style="background-color: #FEF3C7; border-left: 4px solid ${colors.warning}; padding: 16px; margin: 16px 0; border-radius: 0 6px 6px 0;">
      <h3 style="margin: 0 0 12px; color: ${colors.warning}; font-size: 16px;">
        ⚠️ Importante - Faturamento
      </h3>
      <p style="margin: 0 0 12px; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
        <strong>Você deve emitir Nota Fiscal CONTRA a plataforma E-rádios</strong> no valor de <strong>${formatCurrency(data.broadcasterValue)}</strong> (80% do valor bruto).
      </p>
      <p style="margin: 0; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
        O pagamento será efetuado pela plataforma via transferência bancária/boleto, <strong>NÃO via wallet da plataforma</strong>.
      </p>
    </div>
    
    <h3 style="margin: 24px 0 12px; color: ${colors.primary}; font-size: 16px;">
      📋 Dados para Emissão da NF (Tomador do Serviço):
    </h3>
    
    <div style="background-color: ${colors.gray100}; padding: 16px; border-radius: 6px; margin: 16px 0;">
      <table cellpadding="4" cellspacing="0" width="100%" style="font-size: 14px;">
        <tr>
          <td style="color: ${colors.gray600}; font-weight: 600; padding: 8px 0;">Razão Social:</td>
          <td style="color: ${colors.gray800}; padding: 8px 0;">${data.platformBillingData.razaoSocial}</td>
        </tr>
        <tr>
          <td style="color: ${colors.gray600}; font-weight: 600; padding: 8px 0;">CNPJ:</td>
          <td style="color: ${colors.gray800}; padding: 8px 0;">${data.platformBillingData.cnpj}</td>
        </tr>
        <tr>
          <td style="color: ${colors.gray600}; font-weight: 600; padding: 8px 0;">Endereço:</td>
          <td style="color: ${colors.gray800}; padding: 8px 0;">${data.platformBillingData.address}</td>
        </tr>
        <tr>
          <td style="color: ${colors.gray600}; font-weight: 600; padding: 8px 0;">E-mail Financeiro:</td>
          <td style="color: ${colors.gray800}; padding: 8px 0;">${data.platformBillingData.email}</td>
        </tr>
        <tr>
          <td style="color: ${colors.gray600}; font-weight: 600; padding: 8px 0;">Telefone:</td>
          <td style="color: ${colors.gray800}; padding: 8px 0;">${data.platformBillingData.phone}</td>
        </tr>
        <tr>
          <td style="color: ${colors.gray600}; font-weight: 600; padding: 8px 0;">Valor a Faturar:</td>
          <td style="color: ${colors.success}; font-weight: 700; font-size: 16px; padding: 8px 0;">${formatCurrency(data.broadcasterValue)}</td>
        </tr>
      </table>
    </div>
    
    ${buttonComponent('Ver Pedido', `${process.env.FRONTEND_URL}/broadcaster/orders`, colors.success)}
    
    <p style="margin: 24px 0 0; color: ${colors.gray600}; font-size: 13px; line-height: 1.6;">
      💡 <strong>Próximos passos:</strong><br>
      1. Veicule a campanha nas datas agendadas<br>
      2. Emita a NF CONTRA a plataforma E-rádios pelos dados acima<br>
      3. Envie a NF para ${data.platformBillingData.email}<br>
      4. Aguarde o pagamento conforme prazo acordado
    </p>
  `;

  await sendEmail({
    to: data.broadcasterEmail,
    subject,
    html: emailTemplate(content, `Pedido ${data.orderNumber} aprovado - Emitir NF contra plataforma`)
  });
};

/**
 * Email para cliente confirmando recebimento do pagamento da NF
 */
export const sendPaymentConfirmed = async (data: {
  clientEmail: string;
  clientName: string;
  orderNumber: string;
  totalValue: number;
  paidAt: Date;
}) => {
  const subject = `✅ Pagamento Confirmado - Pedido #${data.orderNumber}`;

  const content = `
    <div style="text-align: center; margin-bottom: 24px;">
      <span style="font-size: 48px;">✅</span>
    </div>
    
    <h2 style="margin: 0 0 16px; color: ${colors.success}; font-size: 20px; text-align: center;">
      Pagamento Recebido
    </h2>
    
    <p style="margin: 0 0 16px; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
      Olá <strong>${data.clientName}</strong>,
    </p>
    
    <p style="margin: 0 0 16px; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
      Confirmamos o recebimento do pagamento da Nota Fiscal referente ao pedido <strong>#${data.orderNumber}</strong>.
    </p>
    
    <div style="background-color: #ECFDF5; border-left: 4px solid ${colors.success}; padding: 16px; margin: 16px 0; border-radius: 0 6px 6px 0;">
      ${infoBox('Confirmação de Pagamento', [
    { label: 'Pedido', value: data.orderNumber },
    { label: 'Valor Pago', value: formatCurrency(data.totalValue) },
    { label: 'Data de Confirmação', value: new Date(data.paidAt).toLocaleDateString('pt-BR') }
  ])}
    </div>
    
    <p style="margin: 16px 0; color: ${colors.gray600}; font-size: 14px; line-height: 1.6;">
      Sua campanha já está sendo veiculada conforme o cronograma aprovado. Em breve você receberá os comprovantes de veiculação (OPECs).
    </p>
    
    ${buttonComponent('Ver Minhas Campanhas', `${process.env.FRONTEND_URL}/my-campaigns`, colors.success)}
    
    <p style="margin: 24px 0 0; color: ${colors.gray600}; font-size: 13px; text-align: center;">
      Obrigado por escolher a E-rádios! 🎙️
    </p>
  `;

  await sendEmail({
    to: data.clientEmail,
    subject,
    html: emailTemplate(content, `Pagamento do pedido ${data.orderNumber} confirmado`)
  });
};

// ===========================================
// CONFIRMAÇÃO DE EMAIL (REGISTRO)
// ===========================================

/**
 * Email para confirmar criação de conta
 */
export const sendEmailConfirmation = async (
  email: string,
  name: string,
  token: string
) => {
  const confirmUrl = `${process.env.FRONTEND_URL}/confirm-email/${token}`;

  const content = `
    ${greeting(name)}

    ${paragraph('Obrigado por se cadastrar na <strong>E-rádios</strong>! Para completar seu cadastro e ativar sua conta, confirme seu endereço de email clicando no botão abaixo.')}

    ${divider()}

    ${alertCard('Este link expira em <strong>24 horas</strong>. Após este período, será necessário realizar um novo cadastro.', 'warning')}

    ${paragraph('Se você não realizou este cadastro, ignore este email.', { center: true })}
  `;

  await sendEmail({
    to: email,
    subject: '📧 Confirme seu Email - E-rádios',
    html: createEmailTemplate({
      title: 'Bem-vindo à E-rádios!',
      subtitle: 'Confirme seu email para ativar sua conta',
      content,
      buttonText: '✅ Confirmar Email',
      buttonUrl: confirmUrl,
      buttonColor: colors.tertiary,
      preheader: 'Confirme seu email para ativar sua conta na E-rádios',
      showLogo: false
    })
  });
};

// ===========================================
// AUTENTICAÇÃO EM DUAS ETAPAS (2FA)
// ===========================================

/**
 * Email para habilitar autenticação em duas etapas
 */
export const sendTwoFactorEnableEmail = async (
  email: string,
  name: string,
  token: string
) => {
  const confirmUrl = `${process.env.FRONTEND_URL}/auth/confirm-2fa/${token}`;

  const content = `
    ${greeting(name)}
    
    ${paragraph('Você solicitou a ativação da <strong>Autenticação em Duas Etapas (2FA)</strong> na sua conta E-rádios.')}
    
    ${paragraph('Este é um recurso de segurança adicional que protege sua conta contra acessos não autorizados. Após ativado, você precisará confirmar seus logins através do email cadastrado.')}
    
    ${divider()}
    
    <h3 style="margin: 24px 0 16px; color: ${colors.gray800}; font-size: 18px; font-weight: 700;">
      🛡️ Como Funciona?
    </h3>
    
    ${list([
    '<strong style="color: ' + colors.tertiary + ';">Passo 1:</strong> Login normal com email e senha',
    '<strong style="color: ' + colors.tertiary + ';">Passo 2:</strong> Receba email com link de confirmação',
    '<strong style="color: ' + colors.tertiary + ';">Passo 3:</strong> Clique no link para acessar a plataforma'
  ], true)}
      
    ${divider()}
    
    ${alertCard('Este link expira em <strong>24 horas</strong>. Após este período, será necessário solicitar uma nova ativação.', 'warning')}
    
    ${paragraph('Se você não solicitou esta ativação, ignore este email. Sua conta permanecerá segura.', { center: true })}
  `;

  await sendEmail({
    to: email,
    subject: '🔐 Ative a Autenticação em Duas Etapas - E-rádios',
    html: createEmailTemplate({
      title: 'Proteja sua Conta',
      subtitle: 'Ative a Autenticação em Duas Etapas',
      content,
      buttonText: '✅ Ativar 2FA Agora',
      buttonUrl: confirmUrl,
      buttonColor: colors.tertiary,
      preheader: 'Confirme a ativação da autenticação em duas etapas na E-rádios'
    })
  });

};

/**
 * Email para confirmação de login com 2FA
 */
export const sendTwoFactorLoginEmail = async (
  email: string,
  name: string,
  token: string
) => {
  const confirmUrl = `${process.env.FRONTEND_URL}/auth/verify-2fa/${token}`;
  const currentDate = new Date();
  const formattedDate = currentDate.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
  const formattedTime = currentDate.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit'
  });

  const content = `
    ${greeting(name)}
    
    ${paragraph('Detectamos uma <strong>tentativa de login</strong> na sua conta.', { bold: true })}
    
    ${infoCard('Detalhes do Acesso', [
    { label: 'Data', value: formattedDate },
    { label: 'Horário', value: formattedTime },
    { label: 'Dispositivo', value: 'Navegador Web' }
  ], colors.primary)}
    
    ${alertCard('Este link expira em <strong>10 minutos</strong>. Por segurança, você precisará fazer login novamente após esse período.', 'warning')}
    
    ${divider()}
    
    ${alertCard('<strong>⚠️ Não foi você?</strong><br>Se você não tentou fazer login, <strong>NÃO clique no link</strong>. Alguém pode ter sua senha. Recomendamos alterar sua senha imediatamente.', 'error')}
    
    ${paragraph('Dúvidas? Entre em contato com nosso suporte: dani@hubradios.com.br', { center: true })}
  `;

  await sendEmail({
    to: email,
    subject: '🔑 Confirmação de Login - E-rádios',
    html: createEmailTemplate({
      title: 'Confirmação de Login',
      subtitle: 'Autenticação em Duas Etapas',
      icon: '🔑',
      content,
      buttonText: '✅ Confirmar e Fazer Login',
      buttonUrl: confirmUrl,
      buttonColor: colors.tertiary,
      preheader: 'Confirme seu login na E-rádios - Autenticação em duas etapas'
    })
  });

};

/**
 * Envia código de 6 dígitos para verificação no login
 */
export const sendTwoFactorCodeEmail = async (
  email: string,
  name: string,
  code: string
) => {
  const content = `
    ${greeting(name)}
    ${paragraph('Detectamos um login na sua conta de um dispositivo não reconhecido.')}
    ${paragraph('Para sua segurança, digite o código abaixo para confirmar que é você:', { bold: true })}
    
    <div style="text-align: center; margin: 32px 0;">
      <div style="
        display: inline-block;
        background: linear-gradient(135deg, #FCE7F3 0%, #FBCFE8 100%);
        border: 2px solid ${colors.tertiary};
        border-radius: 16px;
        padding: 24px 48px;
      ">
        <div style="
          font-size: 48px;
          font-weight: 800;
          letter-spacing: 8px;
          color: ${colors.tertiary};
          font-family: 'Courier New', monospace;
        ">${code}</div>
      </div>
    </div>
    
    ${alertCard('Este código expira em 10 minutos.', 'warning')}
    ${paragraph('Se você não tentou fazer login, altere sua senha imediatamente.')}
  `;

  await sendEmail({
    to: email,
    subject: '🔐 Código de Verificação - E-rádios',
    html: createEmailTemplate({
      title: 'Código de Verificação',
      subtitle: 'Confirme sua identidade',
      content,
      preheader: 'Seu código de verificação - Autenticação em duas etapas',
      showLogo: false
    })
  });

};

// ===========================================
// RECUPERAÇÃO DE SENHA
// ===========================================

/**
 * Email para redefinição de senha
 */
export const sendPasswordResetEmail = async (
  email: string,
  name: string,
  token: string
) => {
  const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password/${token}`;

  const content = `
    ${greeting(name)}

    ${paragraph('Recebemos uma solicitação para redefinir a senha da sua conta na <strong>E-rádios</strong>.')}

    ${paragraph('Clique no botão abaixo para criar uma nova senha:')}

    ${divider()}

    ${alertCard('Este link expira em <strong>1 hora</strong>. Após este período, será necessário solicitar uma nova redefinição.', 'warning')}

    ${paragraph('Se você não solicitou a redefinição de senha, ignore este email. Sua senha permanecerá inalterada.', { center: true })}
  `;

  await sendEmail({
    to: email,
    subject: '🔑 Redefinir Senha - E-rádios',
    html: createEmailTemplate({
      title: 'Redefinir Senha',
      subtitle: 'Crie uma nova senha para sua conta',
      content,
      buttonText: '🔑 Redefinir Minha Senha',
      buttonUrl: resetUrl,
      buttonColor: colors.tertiary,
      preheader: 'Você solicitou a redefinição de senha na E-rádios',
      showLogo: false
    })
  });
};

// ===========================================
// EXEMPLOS DE USO DO TEMPLATE GENÉRICO
// ===========================================

/**
 * EXEMPLO 1: Email de boas-vindas
 * 
 * export const sendWelcomeEmail = async (email: string, name: string) => {
 *   const content = `
 *     ${greeting(name)}
 *     ${paragraph('Seja bem-vindo(a) à <strong>E-rádios</strong>! Estamos muito felizes em ter você conosco.')}
 *     ${paragraph('Nossa plataforma conecta anunciantes e emissoras de rádio de forma simples e eficiente.')}
 *     ${divider()}
 *     ${list([
 *       'Acesse o marketplace de emissoras',
 *       'Crie campanhas em minutos',
 *       'Acompanhe resultados em tempo real'
 *     ])}
 *   `;
 *   
 *   await sendEmail({
 *     to: email,
 *     subject: 'Bem-vindo à E-rádios!',
 *     html: createEmailTemplate({
 *       title: 'Bem-vindo à E-rádios!',
 *       subtitle: 'Sua conta foi criada com sucesso',
 *       icon: '🎉',
 *       content,
 *       buttonText: 'Acessar Plataforma',
 *       buttonUrl: `${process.env.FRONTEND_URL}/home`,
 *       buttonColor: colors.primary
 *     })
 *   });
 * };
 */

/**
 * EXEMPLO 2: Confirmação de pedido
 * 
 * export const sendOrderConfirmation = async (email: string, name: string, orderNumber: string, totalAmount: number) => {
 *   const content = `
 *     ${greeting(name)}
 *     ${paragraph('Seu pedido foi recebido com sucesso!')}
 *     ${infoCard('Detalhes do Pedido', [
 *       { label: 'Número do Pedido', value: `#${orderNumber}` },
 *       { label: 'Valor Total', value: `R$ ${totalAmount.toFixed(2)}` },
 *       { label: 'Status', value: 'Aguardando Aprovação' }
 *     ], colors.success)}
 *     ${alertCard('A emissora tem até 48h para aceitar seu pedido. Você será notificado por email.', 'info')}
 *   `;
 *   
 *   await sendEmail({
 *     to: email,
 *     subject: `Pedido #${orderNumber} Recebido - E-rádios`,
 *     html: createEmailTemplate({
 *       title: 'Pedido Recebido!',
 *       subtitle: `Pedido #${orderNumber}`,
 *       icon: '✅',
 *       content,
 *       buttonText: 'Ver Pedido',
 *       buttonUrl: `${process.env.FRONTEND_URL}/orders/${orderNumber}`,
 *       buttonColor: colors.success
 *     })
 *   });
 * };
 */

/**
 * EXEMPLO 3: Alerta de segurança
 * 
 * export const sendSecurityAlert = async (email: string, name: string, ipAddress: string) => {
 *   const content = `
 *     ${greeting(name)}
 *     ${paragraph('Detectamos uma tentativa de login na sua conta:', { bold: true })}
 *     ${infoCard('Detalhes do Acesso', [
 *       { label: 'IP', value: ipAddress },
 *       { label: 'Data/Hora', value: new Date().toLocaleString('pt-BR') },
 *       { label: 'Dispositivo', value: 'Desconhecido' }
 *     ], colors.error)}
 *     ${alertCard('Se foi você, ignore este email. Caso contrário, <strong>altere sua senha imediatamente</strong>.', 'error')}
 *     ${divider()}
 *     ${paragraph('Recomendações de segurança:', { bold: true })}
 *     ${list([
 *       'Habilite a autenticação em duas etapas',
 *       'Use senhas fortes e únicas',
 *       'Nunca compartilhe suas credenciais'
 *     ])}
 *   `;
 *   
 *   await sendEmail({
 *     to: email,
 *     subject: '⚠️ Tentativa de Login Detectada - E-rádios',
 *     html: createEmailTemplate({
 *       title: 'Alerta de Segurança',
 *       subtitle: 'Tentativa de login na sua conta',
 *       icon: '🚨',
 *       content,
 *       buttonText: 'Alterar Senha',
 *       buttonUrl: `${process.env.FRONTEND_URL}/reset-password`,
 *       buttonColor: colors.error
 *     })
 *   });
 * };
 */

/**
 * COMPONENTES DISPONÍVEIS:
 * 
 * - greeting(name)                    → Saudação personalizada
 * - paragraph(text, options)          → Parágrafo de texto
 * - infoCard(title, items, color)     → Card com informações tabuladas
 * - alertCard(text, type)             → Card de alerta (success/warning/error/info)
 * - list(items, ordered)              → Lista de itens (ordenada ou não)
 * - divider()                         → Separador visual
 * 
 * TEMPLATE PRINCIPAL:
 * 
 * createEmailTemplate({
 *   title: string,           // Título principal (obrigatório)
 *   subtitle?: string,       // Subtítulo opcional
 *   content: string,         // Conteúdo HTML (obrigatório)
 *   buttonText?: string,     // Texto do botão
 *   buttonUrl?: string,      // URL do botão
 *   buttonColor?: string,    // Cor do botão (padrão: primary)
 *   preheader?: string,      // Texto de preview
 *   icon?: string,           // Emoji ou ícone principal
 *   showLogo?: boolean       // Mostrar logo (padrão: true)
 * })
 */

// ===========================================
// EMAILS DE SOLICITAÇÕES DE CONTATO (QUOTES)
// ===========================================

/**
 * Email para cliente confirmando recebimento da solicitação
 */
export const sendQuoteConfirmationToClient = async (
  buyer: { email: string; name: string },
  quoteRequest: { requestNumber: string; totalValue: number; items: any[] }
) => {
  const content = `
    ${greeting(buyer.name)}
    
    ${paragraph('Recebemos sua solicitação de contato comercial com sucesso! 🎉', { bold: true })}
    
    ${paragraph('Nossa equipe comercial irá analisar sua solicitação e entrará em contato em breve para discutir os detalhes da campanha e formas de pagamento.')}
    
    ${infoCard('Resumo da Solicitação', [
    { label: 'Número', value: quoteRequest.requestNumber },
    { label: 'Valor Total Estimado', value: formatCurrency(quoteRequest.totalValue) },
    { label: 'Quantidade de Spots', value: `${quoteRequest.items.length}` },
    { label: 'Status', value: '📋 Aguardando Contato' }
  ], colors.tertiary)}
    
    ${alertCard('<strong>Próximos Passos:</strong><br>' +
    '1️⃣ Nossa equipe analisará sua solicitação<br>' +
    '2️⃣ Entraremos em contato em até 24 horas<br>' +
    '3️⃣ Definiremos juntos os detalhes finais e forma de pagamento<br>' +
    '4️⃣ Após acordo, sua campanha será ativada!', 'info')}
    
    ${divider()}
    
    ${paragraph('Você pode acompanhar o status da sua solicitação na plataforma a qualquer momento.', { center: true })}
  `;

  await sendEmail({
    to: buyer.email,
    subject: `✅ Solicitação ${quoteRequest.requestNumber} Recebida - E-rádios`,
    html: createEmailTemplate({
      title: 'Solicitação Recebida!',
      subtitle: `Solicitação ${quoteRequest.requestNumber}`,
      icon: '✅',
      content,
      buttonText: 'Acompanhar Solicitação',
      buttonUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/my-requests`,
      buttonColor: colors.tertiary,
      preheader: 'Sua solicitação foi recebida! Nossa equipe entrará em contato.'
    })
  });

};

/**
 * Email para admin quando nova solicitação é criada
 */
export const sendQuoteRequestToAdmin = async (
  quoteRequest: any,
  buyer: { name: string; email: string; phone?: string; userType: string }
) => {
  // Email do admin (pode vir de variável de ambiente)
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@E-rádios.com';

  // Formata lista de emissoras envolvidas
  const broadcasters = [...new Set(quoteRequest.items.map((item: any) => item.broadcasterName))];

  // Monta detalhes dos itens
  const itemsDetails = quoteRequest.items.map((item: any, index: number) => `
    <div style="background-color: ${colors.gray50}; padding: 12px; border-radius: 6px; margin: 8px 0;">
      <strong style="color: ${colors.tertiary};">Item ${index + 1}:</strong> ${item.productName}<br>
      <span style="color: ${colors.gray600}; font-size: 13px;">
        📻 ${item.broadcasterName} | 
        📊 ${item.quantity} inserção(ões) | 
        💰 ${formatCurrency(item.totalPrice)}
      </span><br>
      <span style="color: ${colors.gray600}; font-size: 13px;">
        🎙️ Material: ${item.material?.type === 'audio' ? 'Áudio pronto' : item.material?.type === 'script' ? 'Roteiro para produção' : 'Texto para locução'}
      </span>
    </div>
  `).join('');

  const userTypeLabel = buyer.userType === 'agency' ? '🏢 Agência' : '👤 Anunciante';

  const content = `
    <div style="text-align: center; margin-bottom: 24px;">
      <span style="font-size: 64px;">🔔</span>
    </div>
    
    <h2 style="margin: 0 0 16px; color: ${colors.tertiary}; font-size: 22px; text-align: center;">
      Nova Solicitação de Contato!
    </h2>
    
    ${alertCard('<strong>ATENÇÃO:</strong> Uma nova solicitação de contato comercial foi criada e precisa de acompanhamento.', 'warning')}
    
    ${infoCard('Dados do Cliente', [
    { label: 'Nome', value: buyer.name },
    { label: 'Email', value: buyer.email },
    { label: 'Telefone', value: buyer.phone || 'Não informado' },
    { label: 'Tipo', value: userTypeLabel }
  ], colors.primary)}
    
    ${infoCard('Resumo da Solicitação', [
    { label: 'Número', value: quoteRequest.requestNumber },
    { label: 'Valor Total', value: formatCurrency(quoteRequest.totalValue) },
    { label: 'Quantidade de Items', value: `${quoteRequest.items.length}` },
    { label: 'Emissoras Envolvidas', value: broadcasters.join(', ') },
    { label: 'Data', value: formatDate(quoteRequest.createdAt) }
  ], colors.tertiary)}
    
    ${divider()}
    
    <h3 style="margin: 20px 0 12px; color: ${colors.gray800}; font-size: 16px;">
      📦 Detalhes dos Items Solicitados:
    </h3>
    
    ${itemsDetails}
    
    ${divider()}
    
    ${quoteRequest.clientNotes ? `
      <h3 style="margin: 20px 0 12px; color: ${colors.gray800}; font-size: 16px;">
        💬 Observações do Cliente:
      </h3>
      <div style="background-color: ${colors.gray100}; padding: 16px; border-radius: 6px; border-left: 4px solid ${colors.tertiary};">
        <p style="margin: 0; color: ${colors.gray700}; font-size: 14px; line-height: 1.6;">
          ${quoteRequest.clientNotes}
        </p>
      </div>
      ${divider()}
    ` : ''}
    
    ${alertCard(`<strong>⏰ Ação Necessária:</strong><br>Entre em contato com ${buyer.name} em até 24 horas para dar andamento à negociação.`, 'error')}
    
    ${paragraph('Acesse o painel administrativo para ver todos os detalhes, materiais anexados e gerenciar esta solicitação.', { center: true })}
  `;

  await sendEmail({
    to: adminEmail,
    subject: `🔔 [ADMIN] Nova Solicitação ${quoteRequest.requestNumber} - ${buyer.name}`,
    html: createEmailTemplate({
      title: 'Nova Solicitação Recebida!',
      subtitle: `Solicitação ${quoteRequest.requestNumber}`,
      icon: '🔔',
      content,
      buttonText: 'Ver Solicitação no Admin',
      buttonUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin/quote-requests`,
      buttonColor: colors.error,
      preheader: `Nova solicitação de ${buyer.name} - ${formatCurrency(quoteRequest.totalValue)}`
    })
  });

};

// ===========================================
// EMAILS DE TRANSIÇÃO DE STATUS (ADMIN → CLIENTE)
// ===========================================

/**
 * Email para cliente quando pedido vai para "Aguardando Pagamento" (pending_payment)
 * Disparado quando admin muda status de pending_contact → pending_payment
 */
export const sendOrderPendingPaymentToClient = async (data: {
  orderNumber: string;
  buyerName: string;
  buyerEmail: string;
  totalValue: number;
}) => {
  const content = `
    ${greeting(data.buyerName)}

    ${paragraph('Nossa equipe comercial entrou em contato e seu pedido está aguardando pagamento para prosseguir.')}

    ${infoCard('Detalhes do Pedido', [
    { label: 'Pedido', value: `#${data.orderNumber}` },
    { label: 'Valor Total', value: formatCurrency(data.totalValue) },
    { label: 'Status', value: '⏳ Aguardando Pagamento' }
  ], colors.warning)}

    ${paragraph('Qualquer dúvida, entre em contato com nossa equipe pelo chat da plataforma.', { center: true })}
  `;

  await sendEmail({
    to: data.buyerEmail,
    subject: `⏳ Pedido #${data.orderNumber} — Aguardando Pagamento`,
    html: createEmailTemplate({
      title: 'Aguardando Pagamento',
      subtitle: `Pedido #${data.orderNumber}`,
      content,
      buttonText: 'Acessar Meu Pedido',
      buttonUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/my-campaigns`,
      buttonColor: colors.warning,
      preheader: `Seu pedido #${data.orderNumber} está aguardando pagamento`
    })
  });
};

/**
 * Email para cliente quando pagamento é confirmado pelo admin (paid)
 * Disparado quando admin muda status → paid (pagamento recebido manualmente)
 */
export const sendOrderPaidConfirmedToClient = async (data: {
  orderNumber: string;
  buyerName: string;
  buyerEmail: string;
  totalValue: number;
}) => {
  const content = `
    ${greeting(data.buyerName)}

    ${paragraph('Ótima notícia! 🎉 Recebemos a confirmação do seu pagamento e seu pedido foi marcado como pago.')}

    ${infoCard('Detalhes do Pedido', [
    { label: 'Pedido', value: `#${data.orderNumber}` },
    { label: 'Valor Pago', value: formatCurrency(data.totalValue) },
    { label: 'Status', value: '✅ Pagamento Confirmado' }
  ], colors.success)}

    ${alertCard('Nosso time está analisando os detalhes da campanha. Em breve sua veiculação será aprovada!', 'success')}

    ${paragraph('Acompanhe o status da sua campanha em tempo real pela plataforma.', { center: true })}
  `;

  await sendEmail({
    to: data.buyerEmail,
    subject: `✅ Pagamento Confirmado — Pedido #${data.orderNumber}`,
    html: createEmailTemplate({
      title: 'Pagamento Confirmado!',
      subtitle: `Pedido #${data.orderNumber}`,
      content,
      buttonText: 'Acompanhar Campanha',
      buttonUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/my-campaigns`,
      buttonColor: colors.success,
      preheader: `Pagamento do pedido #${data.orderNumber} confirmado com sucesso!`
    })
  });
};

/**
 * Email para cliente quando campanha entra em produção / veiculação aprovada (approved)
 * Disparado quando admin aprova o pedido (adminApproveOrder)
 */
export const sendOrderInProductionToClient = async (data: {
  orderNumber: string;
  buyerName: string;
  buyerEmail: string;
  totalValue: number;
  broadcasterCount: number;
}) => {
  const content = `
    ${greeting(data.buyerName)}

    ${paragraph('Sua campanha foi aprovada e está <strong>em produção</strong>! 🚀 As emissoras já receberam o sinal verde para veicular seus anúncios.')}

    ${infoCard('Resumo da Campanha', [
    { label: 'Pedido', value: `#${data.orderNumber}` },
    { label: 'Emissoras', value: `${data.broadcasterCount}` },
    { label: 'Investimento', value: formatCurrency(data.totalValue) },
    { label: 'Status', value: '🚀 Em Produção' }
  ], colors.primary)}

    ${alertCard('Sua campanha será veiculada conforme o agendamento combinado. Você receberá os comprovantes de veiculação ao final da campanha.', 'success')}

    ${paragraph('Acompanhe sua campanha ao vivo pela plataforma!', { center: true })}
  `;

  await sendEmail({
    to: data.buyerEmail,
    subject: `🚀 Campanha #${data.orderNumber} em Produção — E-rádios`,
    html: createEmailTemplate({
      title: 'Campanha Aprovada!',
      subtitle: `Sua campanha está em produção 🎙️`,
      content,
      buttonText: 'Ver Minha Campanha',
      buttonUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/my-campaigns`,
      buttonColor: colors.primary,
      preheader: `Sua campanha #${data.orderNumber} foi aprovada e está em produção!`
    })
  });
};

/**
 * Email para cliente quando campanha é cancelada pelo admin
 * Disparado quando admin muda status → cancelled
 */
export const sendOrderCancelledByAdminToClient = async (data: {
  orderNumber: string;
  buyerName: string;
  buyerEmail: string;
  totalValue: number;
  reason?: string;
}) => {
  const content = `
    ${greeting(data.buyerName)}

    ${paragraph('Informamos que seu pedido foi cancelado pela nossa equipe de suporte.')}

    ${infoCard('Detalhes do Cancelamento', [
    { label: 'Pedido', value: `#${data.orderNumber}` },
    { label: 'Valor', value: formatCurrency(data.totalValue) },
    { label: 'Motivo', value: data.reason || 'Cancelado pela administração' },
    { label: 'Status', value: '❌ Cancelado' }
  ], colors.error)}
  `;

  await sendEmail({
    to: data.buyerEmail,
    subject: `❌ Pedido #${data.orderNumber} Cancelado — E-rádios`,
    html: createEmailTemplate({
      title: 'Pedido Cancelado',
      subtitle: `Pedido #${data.orderNumber}`,
      content,
      buttonText: 'Acessar Plataforma',
      buttonUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/my-campaigns`,
      buttonColor: colors.tertiary,
      preheader: `Seu pedido #${data.orderNumber} foi cancelado`
    })
  });
};

// ===========================================
// EXPORT DEFAULT
// ===========================================

export default {
  sendNewOrderToBroadcaster,
  sendOrderConfirmationToClient,
  sendOrderApprovedToClient,
  sendOrderRejectedToClient,
  sendOrderCancelledToClient,
  // Billing exports
  sendBillingPendingValidation,
  sendBillingAdminNotification,
  sendBillingApproved,
  sendBillingRejected,
  sendInvoiceIssued,
  sendPaymentReminder,
  sendBroadcasterInvoiceRequest,
  sendBillingOrderToBroadcaster,
  sendPaymentConfirmed,
  // Email confirmation export
  sendEmailConfirmation,
  // 2FA exports
  sendTwoFactorEnableEmail,
  sendTwoFactorLoginEmail,
  // Quote Request exports (NEW)
  sendQuoteConfirmationToClient,
  sendQuoteRequestToAdmin,
  // Status transition emails (NEW)
  sendOrderPendingPaymentToClient,
  sendOrderPaidConfirmedToClient,
  sendOrderInProductionToClient,
  sendOrderCancelledByAdminToClient,
  sendNewOrderToAdmin,
  sendOrderReceivedToClient,
  // Utilitários de template (exportar para uso externo)
  createEmailTemplate,
  greeting,
  paragraph,
  infoCard,
  alertCard,
  list,
  divider
};


