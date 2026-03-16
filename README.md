# E-rádios Backend

Backend API para a plataforma E-rádios - Primeira plataforma de mídia programática para rádio do Brasil.

## 🚀 Tecnologias

- Node.js
- Express.js
- TypeScript
- MongoDB (Mongoose)
- JWT (Autenticação)
- bcryptjs (Hash de senhas)

## 📦 Instalação

```bash
# Instalar dependências
npm install
```

## ⚙️ Configuração

Crie um arquivo `.env` na raiz do projeto com as seguintes variáveis:

```env
MONGODB_URI= sua_string_aq
JWT_SECRET=sua_chave_secreta_super_segura_aqui_mude_em_producao
NODE_ENV=development
```

## 🎯 Scripts Disponíveis

```bash
# Desenvolvimento (com hot-reload)
npm run dev

# Build do projeto
npm run build

# Iniciar em produção
npm start
```

## 📁 Estrutura do Projeto

```
E-rádios-backend/
├── src/
│   ├── config/
│   │   └── database.ts       # Configuração MongoDB
│   ├── controllers/
│   │   └── authController.ts # Lógica de autenticação
│   ├── middleware/
│   │   └── auth.ts           # Middleware JWT
│   ├── models/
│   │   └── User.ts           # Model de usuário
│   ├── routes/
│   │   └── authRoutes.ts     # Rotas de autenticação
│   └── index.ts              # Entry point
├── .env                      # Variáveis de ambiente
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

## 🔐 Endpoints da API

### Autenticação

**POST** `/api/auth/register`
- Cadastro de novo usuário (Anunciante, Agência ou Rádio)
- Body: `{ email, password, userType, cpfOrCnpj, companyName, fantasyName, phone }`

**POST** `/api/auth/login`
- Login de usuário
- Body: `{ emailOrCnpj, password }`
- Retorna: `{ token, user }`

### Health Check

**GET** `/health`
- Verificar status do servidor

**GET** `/`
- Informações da API

## 🔧 Desenvolvimento

O servidor está rodando em `http://localhost:5000` em modo desenvolvimento.

## 📝 Tipos de Usuário

- **advertiser**: Anunciante
- **agency**: Agência de publicidade
- **broadcaster**: Emissora de rádio

## 🛡️ Segurança

- Senhas são criptografadas com bcrypt (salt rounds: 10)
- Autenticação via JWT com expiração de 7 dias
- Validação de unicidade de email e CPF/CNPJ
