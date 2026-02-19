# Guia de Uso - Sistema de Template de Email E-rádios

## 📋 Visão Geral

O E-rádios possui um **sistema genérico e reutilizável de templates de email** que permite criar emails profissionais de forma rápida e consistente, alterando apenas os valores necessários.

## 🎨 Características

✅ **Design Profissional** - Gradient header com cores da plataforma  
✅ **Logo Automática** - Logo E-rádios inserida automaticamente  
✅ **Totalmente Parametrizável** - Título, conteúdo, botões, ícones customizáveis  
✅ **Componentes Reutilizáveis** - Saudações, cards, alertas, listas pré-formatados  
✅ **Responsivo** - Compatível com todos os clientes de email  
✅ **Branding Consistente** - Cores, tipografia e espaçamentos padronizados  

---

## 🚀 Como Usar

### 1. Importar a Função Principal

```typescript
import { createEmailTemplate, greeting, paragraph, infoCard, alertCard, list, divider } from '../services/emailService';
```

### 2. Criar o Conteúdo do Email

Use os **componentes reutilizáveis** para montar o conteúdo:

```typescript
const content = `
  ${greeting('João Silva')}
  
  ${paragraph('Este é um parágrafo de texto normal.')}
  
  ${paragraph('Este é um parágrafo em <strong>negrito</strong> e centralizado.', { bold: true, center: true })}
  
  ${divider()}
  
  ${list([
    'Item 1 da lista',
    'Item 2 da lista',
    'Item 3 da lista'
  ])}
`;
```

### 3. Gerar o Email Completo

```typescript
const html = createEmailTemplate({
  title: 'Título Principal',
  subtitle: 'Subtítulo opcional',
  icon: '🎉',
  content,
  buttonText: 'Clique Aqui',
  buttonUrl: 'https://eradios.com.br/action',
  buttonColor: colors.primary,
  preheader: 'Texto de preview do email'
});
```

### 4. Enviar o Email

```typescript
await sendEmail({
  to: 'usuario@exemplo.com',
  subject: 'Assunto do Email',
  html
});
```

---

## 📦 Componentes Disponíveis

### `greeting(name: string)`
Saudação personalizada com o nome do usuário.

```typescript
${greeting('Maria Silva')}
// Resultado: "Olá Maria Silva,"
```

---

### `paragraph(text: string, options?)`
Parágrafo de texto com opções de formatação.

**Opções:**
- `bold?: boolean` - Texto em negrito
- `center?: boolean` - Centralizar texto

```typescript
${paragraph('Texto normal')}

${paragraph('Texto centralizado', { center: true })}

${paragraph('Texto <strong>destacado</strong> em negrito', { bold: true })}
```

---

### `infoCard(title: string, items: Array<{label, value}>, color?)`
Card com informações tabuladas (label/valor).

```typescript
${infoCard('Detalhes do Pedido', [
  { label: 'Número do Pedido', value: '#12345' },
  { label: 'Valor Total', value: 'R$ 1.500,00' },
  { label: 'Status', value: 'Aprovado' }
], colors.primary)}
```

**Preview:**
```
┌─────────────────────────────────┐
│ 📋 Detalhes do Pedido          │
├─────────────────────────────────┤
│ Número do Pedido:    #12345    │
│ Valor Total:         R$ 1.500  │
│ Status:              Aprovado   │
└─────────────────────────────────┘
```

---

### `alertCard(text: string, type: 'success' | 'warning' | 'error' | 'info')`
Card de alerta com ícone e cor específica.

```typescript
${alertCard('Sua conta foi criada com sucesso!', 'success')}

${alertCard('Atenção: Este link expira em 24 horas.', 'warning')}

${alertCard('Erro ao processar pagamento.', 'error')}

${alertCard('Você tem uma nova mensagem.', 'info')}
```

**Preview:**
```
✅ Sua conta foi criada com sucesso!
⚠️ Atenção: Este link expira em 24 horas.
❌ Erro ao processar pagamento.
ℹ️ Você tem uma nova mensagem.
```

---

### `list(items: string[], ordered?: boolean)`
Lista de itens (ordenada ou não ordenada).

```typescript
// Lista não ordenada (bullets)
${list([
  'Acesse o marketplace',
  'Crie sua campanha',
  'Acompanhe resultados'
])}

// Lista ordenada (números)
${list([
  'Passo 1: Faça login',
  'Passo 2: Selecione produtos',
  'Passo 3: Finalize pedido'
], true)}
```

---

### `divider()`
Separador visual com gradient.

```typescript
${divider()}
```

---

## 🎨 Configuração do Template Principal

### Interface `EmailConfig`

```typescript
createEmailTemplate({
  title: string,           // ✅ Obrigatório - Título principal
  subtitle?: string,       // ⚪ Opcional - Subtítulo
  content: string,         // ✅ Obrigatório - Conteúdo HTML
  buttonText?: string,     // ⚪ Opcional - Texto do botão de ação
  buttonUrl?: string,      // ⚪ Opcional - URL do botão
  buttonColor?: string,    // ⚪ Opcional - Cor do botão (padrão: primary)
  preheader?: string,      // ⚪ Opcional - Texto de preview
  icon?: string,           // ⚪ Opcional - Emoji principal
  showLogo?: boolean       // ⚪ Opcional - Mostrar logo (padrão: true)
})
```

---

## 🎨 Cores Disponíveis

Use as cores da plataforma através do objeto `colors`:

```typescript
import { colors } from '../services/emailService';

colors.primary         // #4A90E2 - Azul
colors.primaryDark     // #2B6CB0
colors.primaryLight    // #7CB3F0

colors.secondary       // #8B5CF6 - Roxo
colors.secondaryDark   // #7C3AED

colors.tertiary        // #EC4899 - Rosa
colors.tertiaryDark    // #DB2777

colors.success         // #10B981 - Verde
colors.warning         // #F59E0B - Amarelo
colors.error           // #EF4444 - Vermelho
colors.info            // #3B82F6 - Azul claro

colors.gray50 até colors.gray900  // Escalas de cinza
colors.white           // #FFFFFF
colors.black           // #000000
```

---

## 📝 Exemplos Práticos

### Exemplo 1: Email de Boas-Vindas

```typescript
export const sendWelcomeEmail = async (email: string, name: string) => {
  const content = `
    ${greeting(name)}
    
    ${paragraph('Seja bem-vindo(a) à <strong>E-rádios</strong>! 🎉')}
    
    ${paragraph('Nossa plataforma conecta anunciantes e emissoras de rádio de forma simples e eficiente.')}
    
    ${divider()}
    
    <h3 style="margin: 24px 0 16px; color: ${colors.gray800}; font-size: 18px; font-weight: 700;">
      O que você pode fazer:
    </h3>
    
    ${list([
      '🔍 Buscar emissoras por região e audiência',
      '📻 Criar campanhas personalizadas',
      '📊 Acompanhar resultados em tempo real',
      '💰 Gerenciar pagamentos com segurança'
    ])}
    
    ${alertCard('Complete seu perfil para começar a usar todas as funcionalidades!', 'info')}
  `;
  
  await sendEmail({
    to: email,
    subject: 'Bem-vindo à E-rádios! 🎉',
    html: createEmailTemplate({
      title: 'Bem-vindo à E-rádios!',
      subtitle: 'Sua conta foi criada com sucesso',
      icon: '🎉',
      content,
      buttonText: 'Acessar Plataforma',
      buttonUrl: `${process.env.FRONTEND_URL}/home`,
      buttonColor: colors.primary,
      preheader: 'Comece a usar a plataforma E-rádios agora!'
    })
  });
};
```

---

### Exemplo 2: Confirmação de Pedido

```typescript
export const sendOrderConfirmation = async (
  email: string, 
  name: string, 
  orderNumber: string, 
  totalAmount: number,
  items: any[]
) => {
  const itemsList = items.map(item => 
    `<strong>${item.productName}</strong> - ${item.quantity}x - R$ ${item.totalPrice.toFixed(2)}`
  );
  
  const content = `
    ${greeting(name)}
    
    ${paragraph('Seu pedido foi recebido com sucesso! ✅', { bold: true, center: true })}
    
    ${infoCard('Detalhes do Pedido', [
      { label: 'Número do Pedido', value: `#${orderNumber}` },
      { label: 'Valor Total', value: `R$ ${totalAmount.toFixed(2)}` },
      { label: 'Status', value: 'Aguardando Aprovação' },
      { label: 'Prazo', value: 'Até 48 horas' }
    ], colors.success)}
    
    ${divider()}
    
    <h3 style="margin: 24px 0 16px; color: ${colors.gray800}; font-size: 16px; font-weight: 700;">
      📦 Itens do Pedido:
    </h3>
    
    ${list(itemsList)}
    
    ${alertCard('A emissora tem até <strong>48 horas</strong> para aceitar seu pedido. Você será notificado por email.', 'info')}
    
    ${paragraph('Obrigado por usar a E-rádios!', { center: true })}
  `;
  
  await sendEmail({
    to: email,
    subject: `Pedido #${orderNumber} Confirmado - E-rádios`,
    html: createEmailTemplate({
      title: 'Pedido Recebido!',
      subtitle: `Pedido #${orderNumber}`,
      icon: '✅',
      content,
      buttonText: 'Ver Pedido',
      buttonUrl: `${process.env.FRONTEND_URL}/orders/${orderNumber}`,
      buttonColor: colors.success,
      preheader: `Pedido #${orderNumber} recebido com sucesso`
    })
  });
};
```

---

### Exemplo 3: Alerta de Segurança

```typescript
export const sendSecurityAlert = async (
  email: string, 
  name: string, 
  ipAddress: string,
  location: string
) => {
  const content = `
    ${greeting(name)}
    
    ${paragraph('Detectamos uma <strong>tentativa de login</strong> na sua conta.', { bold: true })}
    
    ${infoCard('Detalhes do Acesso', [
      { label: 'IP', value: ipAddress },
      { label: 'Localização', value: location },
      { label: 'Data/Hora', value: new Date().toLocaleString('pt-BR') },
      { label: 'Dispositivo', value: 'Desktop - Windows' }
    ], colors.error)}
    
    ${alertCard('Se foi você, ignore este email. Caso contrário, <strong>altere sua senha imediatamente</strong>.', 'error')}
    
    ${divider()}
    
    <h3 style="margin: 24px 0 16px; color: ${colors.gray800}; font-size: 16px; font-weight: 700;">
      🔒 Recomendações de Segurança:
    </h3>
    
    ${list([
      'Habilite a <strong>autenticação em duas etapas</strong>',
      'Use senhas fortes e únicas para cada serviço',
      'Nunca compartilhe suas credenciais',
      'Mantenha seu email de recuperação atualizado'
    ])}
  `;
  
  await sendEmail({
    to: email,
    subject: '⚠️ Tentativa de Login Detectada - E-rádios',
    html: createEmailTemplate({
      title: 'Alerta de Segurança',
      subtitle: 'Nova tentativa de login',
      icon: '🚨',
      content,
      buttonText: 'Alterar Senha Agora',
      buttonUrl: `${process.env.FRONTEND_URL}/reset-password`,
      buttonColor: colors.error,
      preheader: 'Detectamos atividade suspeita na sua conta'
    })
  });
};
```

---

### Exemplo 4: Notificação Simples

```typescript
export const sendPaymentReceived = async (
  email: string, 
  name: string, 
  amount: number
) => {
  const content = `
    ${greeting(name)}
    
    ${paragraph('Recebemos seu pagamento! ✅', { bold: true, center: true })}
    
    ${paragraph('O valor de <strong>R$ ' + amount.toFixed(2) + '</strong> foi creditado na sua carteira.')}
    
    ${alertCard('Seu saldo já está disponível para uso. Você pode começar a criar campanhas agora!', 'success')}
    
    ${paragraph('Acesse a plataforma para conferir seu novo saldo.', { center: true })}
  `;
  
  await sendEmail({
    to: email,
    subject: 'Pagamento Recebido - E-rádios',
    html: createEmailTemplate({
      title: 'Pagamento Confirmado!',
      subtitle: `R$ ${amount.toFixed(2)} creditados`,
      icon: '💰',
      content,
      buttonText: 'Ver Carteira',
      buttonUrl: `${process.env.FRONTEND_URL}/wallet`,
      buttonColor: colors.success
    })
  });
};
```

---

## 🎯 Boas Práticas

### ✅ FAZER

1. **Use os componentes pré-definidos** - Garantem consistência visual
2. **Mensagens claras e diretas** - Usuários leem emails rapidamente
3. **Um CTA por email** - Não confunda com múltiplos botões
4. **Teste em diferentes clientes** - Gmail, Outlook, Apple Mail
5. **Preheader informativo** - Ajuda a identificar o email
6. **Cores da plataforma** - Use o objeto `colors`

### ❌ EVITAR

1. **HTML complexo demais** - Pode quebrar em alguns clientes
2. **Imagens externas excessivas** - Aumenta tempo de carregamento
3. **Textos muito longos** - Use listas e cards para organizar
4. **Múltiplos CTAs** - Confunde o usuário sobre a ação principal
5. **Cores hardcoded** - Use sempre `colors.nomeDaCor`

---

## 🔧 Configuração de Ambiente

### Variáveis de Ambiente Necessárias

```bash
# .env
FRONTEND_URL=https://eradios.com.br
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=noreply@eradios.com.br
SMTP_PASS=sua_senha_aqui
```

### Logo da Plataforma

Certifique-se de que o arquivo `eradios.png` esteja disponível em:
```
signalads-frontend/public/eradios.png
```

O template buscará a logo em: `${process.env.FRONTEND_URL}/eradios.png`

---

## 📚 Referência Completa

### Todos os Componentes

```typescript
// Saudação
greeting(name: string)

// Parágrafos
paragraph(text: string, options?: { bold?: boolean; center?: boolean })

// Cards informativos
infoCard(title: string, items: Array<{label, value}>, color?: string)

// Alertas
alertCard(text: string, type: 'success' | 'warning' | 'error' | 'info')

// Listas
list(items: string[], ordered?: boolean)

// Separador
divider()

// Template completo
createEmailTemplate({
  title: string,
  subtitle?: string,
  content: string,
  buttonText?: string,
  buttonUrl?: string,
  buttonColor?: string,
  preheader?: string,
  icon?: string,
  showLogo?: boolean
})
```

---

## 🎨 Design System

### Hierarquia Tipográfica

- **Título Principal**: 28px, bold, branco (no header gradient)
- **Subtítulo**: 16px, medium, branco/transparente
- **H2**: 26px, bold, gray900
- **H3**: 18px, bold, gray800
- **Parágrafo**: 15px, regular, gray700
- **Small**: 13-14px, regular, gray600

### Espaçamentos

- **Entre seções**: 32px (`${divider()}`)
- **Entre parágrafos**: 16px
- **Entre título e conteúdo**: 24px
- **Padding de cards**: 20-24px

### Cores de Feedback

- **Sucesso**: `colors.success` (#10B981) - Verde
- **Aviso**: `colors.warning` (#F59E0B) - Amarelo
- **Erro**: `colors.error` (#EF4444) - Vermelho
- **Info**: `colors.info` (#3B82F6) - Azul claro

---

## 🚀 Próximos Passos

1. **Migrar emails antigos** - Substituir templates legados por este sistema
2. **Criar testes automatizados** - Garantir renderização correta
3. **Internacionalização** - Suporte para PT/EN/ES
4. **Dark Mode** - Variante escura do template
5. **A/B Testing** - Testar diferentes layouts e CTAs

---

**Última atualização**: Janeiro 2026  
**Versão**: 1.0  
**Desenvolvido por**: Equipe E-rádios
