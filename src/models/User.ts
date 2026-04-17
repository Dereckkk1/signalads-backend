import { Schema, model, Document } from 'mongoose';

export interface IUser extends Document {
  name?: string; // Nome completo (advertiser)
  email: string;
  password: string;
  userType: 'advertiser' | 'agency' | 'broadcaster' | 'admin';
  status: 'pending' | 'approved' | 'rejected';
  cpf?: string; // CPF (advertiser)
  cpfOrCnpj: string;
  companyName?: string;
  fantasyName?: string;
  phone: string;
  razaoSocial?: string; // Razão social para faturamento (CNPJ)
  // Campos específicos para broadcaster
  cnpj?: string;
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
      enum: ['pending', 'approved', 'rejected'],
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
    twoFactorSecret: {
      type: String
    },
    twoFactorConfirmedAt: {
      type: Date
    },
    twoFactorPendingToken: {
      type: String
    },
    twoFactorPendingTokenExpires: {
      type: Date
    },

    // Código de verificação 6 dígitos (usado no login)
    twoFactorCode: {
      type: String
    },
    twoFactorCodeExpires: {
      type: Date
    },
    twoFactorSessionToken: {
      type: String
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
      type: String
    },
    emailConfirmTokenExpires: {
      type: Date
    },

    // Password reset
    passwordResetToken: {
      type: String
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

export const User = model<IUser>('User', userSchema);
