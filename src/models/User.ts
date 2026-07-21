import { Schema, model, Document } from 'mongoose';
import crypto from 'crypto';

/**
 * Campos que guardam credenciais de uso unico (tokens de e-mail e 2FA).
 *
 * SEGURANCA (FASE 7.1): estes campos NUNCA sao persistidos em plaintext. O valor
 * cru e enviado ao usuario (e-mail/link) e o banco guarda apenas o SHA-256 — o
 * mesmo padrao ja usado pelo refresh token (`utils/tokenService.ts`). Assim, um
 * dump/leitura do Mongo (backup, replica, log de query, admin curioso) nao rende
 * credenciais utilizaveis: o atacante ve o hash, e o hash nao passa na verificacao.
 *
 * O hashing acontece nos hooks abaixo (save + update), e nao nos controllers, para
 * que QUALQUER caminho de escrita — inclusive controllers fora do fluxo de auth
 * (sub-usuarios de emissora, emissoras-catalogo) — seja coberto automaticamente.
 */
export const HASHED_TOKEN_FIELDS = [
  'passwordResetToken',
  'emailConfirmToken',
  'twoFactorPendingToken',
  'twoFactorSessionToken',
  'twoFactorCode',
] as const;

/** SHA-256 hex de um token de uso unico. Usado na escrita (hooks) e na busca. */
export const hashLookupToken = (raw: string): string =>
  crypto.createHash('sha256').update(String(raw)).digest('hex');

/**
 * Politica de bloqueio de conta por falhas de senha (item 4.5 do plano
 * 2026-07-20).
 *
 * O rate limit do /login e chaveado por (IP | e-mail), entao um atacante que
 * ROTACIONA e-mails — o padrao de credential stuffing / password spraying —
 * nunca atinge o teto por par. O lockout por conta e a segunda linha de
 * defesa: mesmo distribuindo IPs e alvos, cada conta so aceita N tentativas
 * dentro da janela.
 */
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const ACCOUNT_LOCK_MINUTES = 15;

export interface IUser extends Document {
  name?: string; // Nome completo (advertiser)
  email: string;
  password: string;
  userType: 'advertiser' | 'agency' | 'broadcaster' | 'admin';
  status: 'pending' | 'approved' | 'rejected' | 'blocked';
  cpf?: string; // CPF (advertiser)
  cpfOrCnpj: string;
  companyName?: string;
  fantasyName?: string;
  phone: string;
  razaoSocial?: string; // Razão social para faturamento (CNPJ)
  // Campos específicos para broadcaster
  cnpj?: string;
  asaasCustomerId?: string;  // ID do customer Asaas, criado lazy no 1o checkout
  address?: {
    cep: string;
    street: string;
    number: string;
    complement?: string;
    neighborhood: string;
    city: string;
    state: string;
    latitude?: number;
    longitude?: number;
  };
  rejectionReason?: string;

  // Favoritos - lista de IDs de emissoras favoritas (para advertiser/agency)
  favorites?: string[];

  // Onboarding para broadcasters
  onboardingCompleted?: boolean;
  completedTours?: string[];
  broadcasterProfile?: {
    // Slug canônico para a página pública /emissora/:slug (único, esparso)
    slug?: string;
    // Etapa 1: Informações Gerais
    generalInfo?: {
      stationName?: string;
      dialFrequency?: string;
      band?: string;
      foundationYear?: number;
      frequency?: number;
      power?: number;
      antennaClass?: string;
    };
    logo?: string;
    comercialEmail?: string;
    website?: string;
    socialMedia?: {
      facebook?: string;
      instagram?: string;
      twitter?: string;
    };

    // Etapa 2: Categorias
    categories?: string[];

    // Etapa 3: Perfil do Público
    audienceProfile?: {
      gender?: {
        male: number;
        female: number;
      };
      ageRange?: string; // Ex: "77% 30+"
      socialClass?: {
        classeAB: number;
        classeC: number;
        classeDE: number;
      };
    };

    // Etapa 4: Cobertura e Alcance
    coverage?: {
      states?: string[];
      cities?: string[]; // Array of strings like "City Name (Distance)"
      totalPopulation?: number;
      streamingUrl?: string;
    };

    // Etapa 5: Regras de Negócio
    businessRules?: {
      minCampaignDuration?: number; // dias
      periodicity?: string;
      minInsertionsPerDay?: number;
      minAdvanceBooking?: number; // dias
      maxAdvanceBooking?: number; // dias
      paymentDeadline?: number; // horas antes
      pricePerInsertion?: number;
    };
    pmm?: number; // PMM or OPM value
  };

  createdAt: Date;
  updatedAt: Date;

  // Bloqueio por tentativas de senha (item 4.5)
  failedLoginAttempts?: number;
  lockUntil?: Date;

  // Autenticação em duas etapas (2FA)
  twoFactorEnabled?: boolean;
  twoFactorSecret?: string;
  twoFactorConfirmedAt?: Date;
  twoFactorPendingToken?: string;
  twoFactorPendingTokenExpires?: Date;

  // Código de verificação 6 dígitos (usado no login)
  twoFactorCode?: string;
  twoFactorCodeExpires?: Date;
  twoFactorSessionToken?: string; // Token opaco para sessao 2FA (em vez de expor ObjectId)
  twoFactorAttempts?: number; // Contador de tentativas falhas

  // Dispositivos confiáveis
  trustedDevices?: Array<{
    deviceId: string;
    deviceName: string;
    lastUsed: Date;
    createdAt: Date;
  }>;

  // Email confirmation
  emailConfirmed?: boolean;
  emailConfirmToken?: string;
  emailConfirmTokenExpires?: Date;

  // Password reset
  passwordResetToken?: string;
  passwordResetTokenExpires?: Date;

  // === MODELO CATÁLOGO (Emissoras gerenciadas pelo Admin) ===
  isCatalogOnly?: boolean; // true = emissora sem conta própria, cadastrada pelo admin
  managedByAdmin?: boolean; // true = admin gerencia produtos, aprovações e OPEC
  createdBy?: any; // ID do admin que criou a emissora catálogo

  // === SUB-USUÁRIOS DE EMISSORA ===
  broadcasterRole?: 'manager' | 'sales'; // manager = usuário principal, sales = vendedor
  parentBroadcasterId?: any; // ref ao broadcaster pai (só para sales)
  groupId?: any; // ref ao grupo de permissões (só para sales)
  maxSubUsers?: number; // limite de sub-usuarios que esta emissora pode criar (apenas para manager). Admin define

  // === PREFERENCIAS DE NOTIFICACAO POR EMAIL ===
  notificationPreferences?: {
    newOrders?: boolean;              // admin: novo pedido na plataforma
    proposalAcceptedRejected?: boolean; // broadcaster, agency: proposta aprovada/recusada
    marketplaceOrders?: boolean;      // broadcaster: novo pedido do marketplace
    ownOrderUpdates?: boolean;        // advertiser, agency: atualizacoes do proprio pedido
  };
}

const userSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      trim: true
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    password: {
      type: String,
      required: true,
      minlength: 8
    },
    userType: {
      type: String,
      enum: ['advertiser', 'agency', 'broadcaster', 'admin'],
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'blocked'],
      default: 'pending'
    },
    cpf: {
      type: String,
      trim: true
    },
    cpfOrCnpj: {
      type: String,
      required: true
    },
    cnpj: {
      type: String,
      trim: true
    },
    asaasCustomerId: { type: String, default: null, index: true },
    companyName: {
      type: String,
      trim: true
    },
    fantasyName: {
      type: String,
      trim: true
    },
    phone: {
      type: String,
      required: true
    },
    razaoSocial: {
      type: String,
      trim: true
    },
    address: {
      cep: String,
      street: String,
      number: String,
      complement: String,
      neighborhood: String,
      city: String,
      state: String,
      latitude: Number,
      longitude: Number
    },
    rejectionReason: {
      type: String
    },
    // Favoritos - lista de IDs de emissoras favoritas (para advertiser/agency)
    favorites: [{
      type: Schema.Types.ObjectId,
      ref: 'User'
    }],
    onboardingCompleted: {
      type: Boolean,
      default: false
    },
    completedTours: {
      type: [String],
      default: []
    },
    broadcasterProfile: {
      slug: { type: String, index: { unique: true, sparse: true } },
      generalInfo: {
        stationName: String,
        dialFrequency: String,
        band: String,
        foundationYear: Number,
        frequency: Number,
        power: Number,
        antennaClass: String
      },
      logo: String,
      comercialEmail: String,
      website: String,
      socialMedia: {
        facebook: String,
        instagram: String,
        twitter: String
      },
      categories: [String],
      audienceProfile: {
        gender: {
          male: Number,
          female: Number
        },
        ageRange: String, // Ex: "77% 30+"
        socialClass: {
          classeAB: Number,
          classeC: Number,
          classeDE: Number
        }
      },
      coverage: {
        states: [String],
        cities: [String], // Array de strings no formato "City (Xkm)"
        totalPopulation: Number,
        streamingUrl: String
      },
      businessRules: {
        minCampaignDuration: Number,
        periodicity: String,
        minInsertionsPerDay: Number,
        minAdvanceBooking: Number,
        maxAdvanceBooking: Number,
        paymentDeadline: Number,
        pricePerInsertion: Number
      },
      pmm: Number
    },

    // Autenticação em duas etapas (2FA)
    twoFactorEnabled: {
      type: Boolean,
      default: false
    },
    failedLoginAttempts: {
      type: Number,
      default: 0,
      select: false
    },
    lockUntil: {
      type: Date,
      select: false
    },
    twoFactorSecret: {
      type: String,
      select: false
    },
    twoFactorConfirmedAt: {
      type: Date
    },
    twoFactorPendingToken: {
      type: String,
      select: false
    },
    twoFactorPendingTokenExpires: {
      type: Date
    },

    // Código de verificação 6 dígitos (usado no login)
    twoFactorCode: {
      type: String,
      select: false
    },
    twoFactorCodeExpires: {
      type: Date
    },
    twoFactorSessionToken: {
      type: String,
      select: false
    },
    twoFactorAttempts: {
      type: Number,
      default: 0
    },

    // Dispositivos confiáveis
    trustedDevices: [{
      deviceId: {
        type: String,
        required: true
      },
      deviceName: {
        type: String,
        required: true
      },
      lastUsed: {
        type: Date,
        default: Date.now
      },
      createdAt: {
        type: Date,
        default: Date.now
      }
    }],

    // Email confirmation
    emailConfirmed: {
      type: Boolean,
      default: false
    },
    emailConfirmToken: {
      type: String,
      select: false
    },
    emailConfirmTokenExpires: {
      type: Date
    },

    // Password reset
    passwordResetToken: {
      type: String,
      select: false
    },
    passwordResetTokenExpires: {
      type: Date
    },

    // === MODELO CATÁLOGO (Emissoras gerenciadas pelo Admin) ===
    isCatalogOnly: {
      type: Boolean,
      default: false
    },
    managedByAdmin: {
      type: Boolean,
      default: false
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },

    // === SUB-USUÁRIOS DE EMISSORA ===
    broadcasterRole: {
      type: String,
      enum: ['manager', 'sales'],
      default: undefined
    },
    parentBroadcasterId: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    groupId: {
      type: Schema.Types.ObjectId,
      ref: 'BroadcasterGroup',
      default: undefined
    },
    maxSubUsers: {
      type: Number,
      min: 0,
      max: 1000,
      default: undefined
    },
    notificationPreferences: {
      newOrders: { type: Boolean, default: true },
      proposalAcceptedRejected: { type: Boolean, default: true },
      marketplaceOrders: { type: Boolean, default: true },
      ownOrderUpdates: { type: Boolean, default: true }
    }
  },
  {
    timestamps: true
  }
);

// ─── Índices de Performance ───────────────────────────────────────────────

// Login: busca por email (único, já indexado via unique: true) e cpfOrCnpj
userSchema.index({ cpfOrCnpj: 1 });  // login via CNPJ

// Marketplace público: busca emissoras aprovadas com onboarding completo
// Query: { userType: 'broadcaster', status: 'approved', onboardingCompleted: true }
userSchema.index({ userType: 1, status: 1, onboardingCompleted: 1 });

// Admin — listagem de usuários paginada e filtrada por tipo e status
// Query: { status: 'pending' } | { userType: 'advertiser', status: 'approved' }
userSchema.index({ status: 1, createdAt: -1 });
userSchema.index({ userType: 1, status: 1, createdAt: -1 });

// Emissoras catálogo criadas pelo admin
userSchema.index({ isCatalogOnly: 1, userType: 1 });

// Busca rápida por tokens 2FA
userSchema.index({ twoFactorPendingToken: 1 });
userSchema.index({ emailConfirmToken: 1 });
userSchema.index({ passwordResetToken: 1 });

// Busca emissoras por cidade/estado (busca geográfica no marketplace)
userSchema.index({ 'broadcasterProfile.coverage.states': 1 });
userSchema.index({ 'broadcasterProfile.categories': 1 });

// Performance: filtro de cidade no marketplace
userSchema.index({ 'address.city': 1 });
// Performance: query principal do marketplace (userType + status + cidade)
userSchema.index({ userType: 1, status: 1, 'address.city': 1 });
// Performance: filtro de audiência por faixa etária
userSchema.index({ 'broadcasterProfile.audienceProfile.ageRange': 1 });
// Performance: ordenação por PMM
userSchema.index({ 'broadcasterProfile.pmm': -1 });
// Performance: endpoint /map (lat/lng + status)
userSchema.index({ userType: 1, status: 1, 'address.latitude': 1, 'address.longitude': 1 });
// Performance: sort por PMM no comparador/marketplace
userSchema.index({ userType: 1, status: 1, 'broadcasterProfile.pmm': -1 });

// Sub-usuários: busca por emissora pai
userSchema.index({ parentBroadcasterId: 1, broadcasterRole: 1 });

// ─────────────────────────────────────────────────────────────
// FASE 7.1 — Hash automatico dos tokens de uso unico
// ─────────────────────────────────────────────────────────────
// Ponto unico de aplicacao: qualquer escrita (save, create, findOneAndUpdate,
// updateOne, updateMany) que atribua um valor a um destes campos grava o SHA-256.
// Quem gera o token guarda o valor CRU numa variavel local e o envia por e-mail;
// quem verifica busca por `hashLookupToken(tokenRecebido)`.
//
// Idempotencia: no `save` so re-hasheia quando o path foi modificado, entao um
// segundo `save()` do mesmo documento nao aplica hash duas vezes.

userSchema.pre('save', function (this: any) {
  for (const field of HASHED_TOKEN_FIELDS) {
    if (!this.isModified(field)) continue;
    const value = this[field];
    if (typeof value === 'string' && value.length > 0) {
      this[field] = hashLookupToken(value);
    }
  }
});

function hashTokensInUpdate(this: any): void {
  const update = this.getUpdate();
  // Pipeline de agregacao ([{ $set: ... }]) nao e suportado — nenhum caminho usa.
  if (!update || Array.isArray(update)) return;
  for (const field of HASHED_TOKEN_FIELDS) {
    if (update.$set && typeof update.$set[field] === 'string' && update.$set[field]) {
      update.$set[field] = hashLookupToken(update.$set[field]);
    }
    if (typeof update[field] === 'string' && update[field]) {
      update[field] = hashLookupToken(update[field]);
    }
  }
  this.setUpdate(update);
}

(userSchema as any).pre('findOneAndUpdate', hashTokensInUpdate);
(userSchema as any).pre('updateOne', hashTokensInUpdate);
(userSchema as any).pre('updateMany', hashTokensInUpdate);

export const User = model<IUser>('User', userSchema);
