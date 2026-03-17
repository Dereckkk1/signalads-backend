# E-radios Backend

API backend da plataforma E-radios — marketplace B2B de publicidade em radio programatica. Conecta anunciantes e agencias (compradores) a emissoras de radio (vendedores).

## Stack

- **Runtime**: Node.js + Express 5.1 + TypeScript 5.9
- **Banco de Dados**: MongoDB Atlas + Mongoose 9
- **Autenticacao**: JWT em cookies httpOnly (access token 15min + refresh token 7d com rotacao automatica e deteccao de roubo) + bcryptjs (12 rounds)
- **Storage**: Google Cloud Storage
- **Email**: Nodemailer (SMTP)
- **IA**: OpenAI SDK (recomendacoes)
- **Seguranca**: Helmet (CSP), rate-limit, hpp, sanitizacao XSS/NoSQL, CSRF double-submit cookie, audit logging

## Quick Start

```bash
npm install
npm run dev     # Dev server com hot-reload (porta 5000)
```

## Scripts

```bash
npm run dev       # nodemon hot-reload
npm run build     # TypeScript → dist/
npm start         # node dist/index.js (producao)
```

## Variaveis de Ambiente (.env)

### Obrigatorias

| Variavel | Descricao |
|----------|-----------|
| `MONGODB_URI` | URI do MongoDB Atlas |
| `JWT_SECRET` | Chave JWT (64+ bytes aleatorios) |
| `FRONTEND_URL` | URL do frontend (ex: `http://localhost:3000`) |

### Opcionais

| Variavel | Descricao | Default |
|----------|-----------|---------|
| `PORT` | Porta do Express | `5000` |
| `NODE_ENV` | Ambiente (`production`, `development`, `test`) | `development` |
| `API_URL` | URL base da API | `http://localhost:5000` |
| `COOKIE_DOMAIN` | Dominio dos cookies (ex: `.eradios.com.br`) | — |
| `GOOGLE_CLOUD_PROJECT_ID` | ID do projeto GCP | — |
| `GOOGLE_CLOUD_KEY_FILE` | Arquivo de chave GCP | — |
| `GOOGLE_CLOUD_BUCKET_NAME` | Nome do bucket GCS | — |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Config SMTP para emails | — |
| `OPENAI_API_KEY` | Chave da API OpenAI | — |
| `ADMIN_EMAIL` | Email do admin para notificacoes | — |

> Detalhes completos em `docs/Platform Optmization/ENV_VARIABLES (concluido).md`

## Estrutura do Projeto

```
signalads-backend/src/
├── config/         # database.ts, storage.ts
├── controllers/    # Logica de negocio (21 controllers)
├── middleware/      # auth.ts, security.ts, csrf.ts, auditLog.ts, metrics.ts
├── models/         # Mongoose schemas + TypeScript interfaces
├── routes/         # Express routers
├── cron/           # Tarefas agendadas (node-cron)
├── services/       # emailService, AIService
├── utils/          # tokenService.ts, stringUtils.ts, helpers
└── index.ts        # Entry point
```

## Controllers

| Controller | Responsabilidade |
|-----------|-----------------|
| `adminController` | Gestao de usuarios, emissoras, pedidos, dashboard admin |
| `authController` | Login, registro, 2FA, JWT, change password |
| `campaignController` | Criacao e gestao de campanhas |
| `catalogBroadcasterController` | CRUD emissoras catalogo |
| `cartController` | Carrinho de compras |
| `orderController` | Pedidos (ciclo de vida completo) |
| `marketplaceController` | Busca publica de emissoras |
| `productController` | CRUD produtos, marketplace queries, mapa, comparacao |
| `productRequestController` | Solicitacoes de produto pela emissora |
| `profileRequestController` | Solicitacoes de perfil pela emissora |
| `uploadController` | Upload de arquivos (validacao dupla: MIME + extensao) |
| `imageController` | Proxy de imagens (cache TTL 7d, max 5000) |
| `materialController` | Gestao de materiais criativos |
| `monitoringController` | Dashboard de monitoramento |
| `dashboardController` | Metricas e dados do dashboard |
| `agencyController` | Gestao de agencias e clientes |
| `radioAnalyticsController` | Analytics de radio |
| `blockedDomainController` | Dominios bloqueados |
| `contactController` | Mensagens de contato |
| `quoteRequestController` | Solicitacoes de orcamento |
| `recommendationController` | Recomendacoes IA |
| `reportController` | Relatorios |

## Models

| Model | Descricao |
|-------|-----------|
| `User` | Todos os tipos de usuario (admin, broadcaster, advertiser, agency) |
| `Product` | Formatos publicitarios (spot type, time slot, preco, share %) |
| `Cart` | Carrinho com items e scheduling |
| `Order` | Pedidos com items e status lifecycle |
| `ProductRequest` | Solicitacoes de produto (create/edit/delete) |
| `ProfileRequest` | Solicitacoes de alteracao de perfil |
| `ContactMessage` | Mensagens de contato |
| `QuoteRequest` | Solicitacoes de orcamento |
| `BlockedDomain` | Dominios bloqueados para registro |
| `AgencyClient` | Clientes vinculados a agencias |
| `SystemMetric` | Metricas do sistema |
| `WebVital` | Metricas de web vitals do frontend |
| `RefreshToken` | Tokens de refresh (hash SHA-256, family tracking, TTL auto) |
| `AuditLog` | Logs de auditoria de acoes admin (TTL 365 dias) |
| `Counter` | Contadores atomicos (orderNumber, quoteRequest) |

## Seguranca

Pipeline de middlewares por request:

```
Request → CORS → Helmet (CSP) → Rate Limit → cookie-parser → JSON body (5MB)
        → mongoSanitize → xssSanitize → hpp → csrfProtection → Rotas
```

- **Auth**: JWT access token (15min) + refresh token (7d) em cookies httpOnly com rotacao e deteccao de roubo
- **2FA**: Codigos CSPRNG de 6 digitos, tokens opacos, limite de 5 tentativas
- **CSRF**: Double-submit cookie pattern
- **XSS**: Sanitizacao de todas as tags HTML via `sanitize-html`
- **NoSQL Injection**: Remoção de operadores `$` e protecao contra prototype pollution
- **Rate Limiting**: 500 req/min global, limites especificos por endpoint sensivel
- **SSRF**: Whitelist de dominios no proxy de imagens
- **Audit Logging**: Acoes admin logadas com TTL de 365 dias
- **Upload**: Validacao dupla (MIME type + extensao)
- **IDOR**: Ownership checks em queries MongoDB

> Detalhes completos em `docs/Agent instructions/security.md`

## Endpoints de Referencia

A API possui 88 endpoints ativos. Alguns dos principais:

| Endpoint | Descricao |
|----------|-----------|
| `POST /api/auth/login` | Login (seta cookies httpOnly) |
| `POST /api/auth/register` | Registro (advertiser/agency apenas) |
| `POST /api/auth/refresh` | Renova tokens via cookie |
| `POST /api/auth/logout` | Revoga tokens + limpa cookies |
| `GET /api/admin/broadcasters` | Lista emissoras |
| `GET /api/products/my-products` | Produtos da emissora logada |
| `POST /api/product-requests` | Criar/editar/deletar produto |
| `GET /api/campaigns/broadcaster-orders` | Pedidos da emissora |
| `GET /api/admin/audit-logs` | Logs de auditoria paginados |
| `GET /api/health` | Health check |

> Documentacao completa da API em `docs/Platform Optmization/API_REAL.md`

## Tipos de Usuario

| Tipo | Role | Descricao |
|------|------|-----------|
| Admin | Controle total | Cria contas de emissoras, monitora sistema |
| Broadcaster | Vendedor | Gerencia inventario de radio, recebe pedidos |
| Advertiser | Comprador | Busca emissoras, cria campanhas |
| Agency | Comprador+ | Como advertiser, com comissao definida pela agencia |

> Apenas `advertiser` e `agency` podem se auto-cadastrar. Contas `broadcaster` e `admin` sao criadas pelo admin.

## Precificacao

Preco final = `netPrice * 1.25` (25% de markup da plataforma). O `netPrice` e o valor liquido da emissora. Pagamento feito por fora da plataforma.

## Ciclo de Vida do Pedido

```
Aguardando contato do admin → Pagamento Pendente → Pago → Agendado → Veiculado → Concluido
                                                                                 ↘ Cancelado / Expirado
```

## Convencoes de Codigo

- **Controllers**: `camelCaseController.ts` — async/await + try-catch, status HTTP correto
- **Models**: `PascalCase.ts` — Mongoose schema + TypeScript interface exportada
- **Routes**: `camelCaseRoutes.ts` — agrupadas por recurso, mapeadas no `index.ts`
- **Erros**: `{ error: "mensagem_descritiva" }` com status code adequado
- **Proibido**: `.then()` chains — sempre async/await

## Documentacao

| Preciso de... | Consulte |
|----------------|----------|
| Regras de negocio e fluxos | `docs/Agent instructions/product.md` |
| Tech stack e convencoes | `docs/Agent instructions/techstack.md` |
| Seguranca completa | `docs/Agent instructions/security.md` |
| Mapa de rotas | `docs/Agent instructions/routes.md` |
| API completa (88 endpoints) | `docs/Platform Optmization/API_REAL.md` |
| Variaveis de ambiente | `docs/Platform Optmization/ENV_VARIABLES (concluido).md` |
| Melhorias pendentes | `docs/Platform Optmization/IMPROVEMENTS (semi-concluido).md` |
| Testes e performance | `docs/Agent instructions/performance.md` |
