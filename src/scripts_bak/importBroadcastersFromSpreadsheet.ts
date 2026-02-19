/**
 * Script para Importação em Massa de Emissoras via Planilha
 * 
 * Este script lê um arquivo TSV/CSV com dados de emissoras, cruza com um XLSX
 * que contém informações complementares (email, telefone, endereço, CNPJ),
 * e insere no MongoDB como emissoras catálogo (gerenciadas pelo admin).
 * 
 * USO:
 *   npx ts-node src/scripts/importBroadcastersFromSpreadsheet.ts <arquivo-tsv> <arquivo-xlsx> [adminId]
 * 
 * EXEMPLO:
 *   npx ts-node src/scripts/importBroadcastersFromSpreadsheet.ts ./data/emissoras.tsv ./data/contatos.xlsx
 *   npx ts-node src/scripts/importBroadcastersFromSpreadsheet.ts ./data/emissoras.tsv ./data/contatos.xlsx 507f1f77bcf86cd799439011
 * 
 * FORMATO DO TSV (dados principais):
 *   Row ID, classeAB, classeC, classeDE, nomePmm, classeAntena, uf, praca, emissora, dial,
 *   estilo, genero, classeAntiga, idade, universo, caixaComercial, Comentarios, logo,
 *   avaliacaoComercial, avCs, Instagram, facebook, capa, audioRadio, descricao,
 *   pracasAbrangencia, pracasAbrangenciaID, KML, IDAnatel, KMZ2, KML2, Universo2
 * 
 * FORMATO DO XLSX (dados complementares):
 *   Nome, E-mail, Telefone, Endereço, Cidade, UF, CPF/CNPJ, Site, Situação
 *   Nome formato: "Emissora | Dial | Cidade/UF" (ex: "Melody | 94,1 | Ribeirão Preto/SP")
 */

import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import * as XLSX from 'xlsx';
import { Product } from '../models/Product';

// Carrega variáveis de ambiente
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Conexão com MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/signalads';

// Schema do usuário (simplificado para o script)
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  userType: { type: String, enum: ['advertiser', 'agency', 'broadcaster', 'admin'], required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved' },
  cpfOrCnpj: { type: String, required: true, unique: true },
  cnpj: String,
  companyName: String,
  fantasyName: String,
  phone: { type: String, required: true },
  address: {
    cep: String,
    street: String,
    number: String,
    complement: String,
    neighborhood: String,
    city: String,
    state: String
  },
  favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  onboardingCompleted: { type: Boolean, default: false },
  broadcasterProfile: {
    generalInfo: {
      stationName: String,
      dialFrequency: String,
      band: String,
      foundationYear: Number,
      frequency: Number,
      power: Number
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
      ageRange: String,
      socialClass: {
        classeAB: Number,
        classeC: Number,
        classeDE: Number
      }
    },
    coverage: {
      states: [String],
      cities: [String],
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
    }
  },
  twoFactorEnabled: { type: Boolean, default: false },
  isCatalogOnly: { type: Boolean, default: false },
  managedByAdmin: { type: Boolean, default: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  trustedDevices: [{ deviceId: String, deviceName: String, lastUsed: Date, createdAt: Date }]
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

// ========================
// INTERFACES
// ========================

interface XLSXContactData {
  nome: string;           // "Melody | 94,1 | Ribeirão Preto/SP"
  email: string;          // "helio@clube.com.br"
  telefone: string;       // "(16) 2101-3500"
  endereco: string;       // "Avenida Nove de Julho, 606 - Jardim Sumaré - CEP: 14025-000"
  cidade: string;         // "Ribeirão Preto"
  uf: string;             // "SP"
  cpfCnpj: string;        // "46.665.188/0001-98"
  site: string;           // URL do site
  situacao: string;       // "Ativo"

  // Campos parseados do nome
  emissora?: string;
  dial?: string;
  cidadeNome?: string;
}

// Índices das colunas do TSV
const COLUMN_INDICES = {
  rowId: 0,
  classeAB: 1,
  classeC: 2,
  classeDE: 3,
  nomePmm: 4,
  classeAntena: 5,
  uf: 6,
  praca: 7,
  emissora: 8,
  dial: 9,
  estilo: 10,
  genero: 11,
  classeAntiga: 12,
  idade: 13,
  universo: 14,
  caixaComercial: 15,
  comentarios: 16,
  logo: 17,
  avaliacaoComercial: 18,
  avCs: 19,
  instagram: 20,
  facebook: 21,
  capa: 22,
  audioRadio: 23,
  descricao: 24,
  pracasAbrangencia: 25,
  pracasAbrangenciaID: 26,
  kml: 27,
  idAnatel: 28,
  kmz2: 29,
  kml2: 30,
  universo2: 31
};

// ========================
// FUNÇÕES PARA XLSX
// ========================

/**
 * Lê o arquivo XLSX e retorna um mapa de contatos indexado por chave de busca
 */
function readXLSXContacts(xlsxPath: string): Map<string, XLSXContactData> {
  console.log(`📖 Lendo arquivo XLSX: ${xlsxPath}`);

  const workbook = XLSX.readFile(xlsxPath);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    console.log('⚠️ XLSX sem planilhas');
    return new Map();
  }
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) {
    console.log('⚠️ XLSX sem worksheet');
    return new Map();
  }

  // Converte para JSON
  const rows: any[] = XLSX.utils.sheet_to_json(worksheet as XLSX.WorkSheet, { header: 1 });

  if (rows.length < 2) {
    console.log('⚠️ XLSX vazio ou sem dados');
    return new Map();
  }

  // Header (primeira linha)
  const header = rows[0] as string[];
  console.log(`📋 Colunas XLSX: ${header.join(', ')}`);

  // Mapeia índices das colunas (case-insensitive)
  const findColumnIndex = (names: string[]): number => {
    for (const name of names) {
      const idx = header.findIndex(h =>
        h?.toString().toLowerCase().trim() === name.toLowerCase()
      );
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const colIndices = {
    nome: findColumnIndex(['nome', 'name', 'emissora']),
    email: findColumnIndex(['e-mail', 'email', 'mail']),
    telefone: findColumnIndex(['telefone', 'phone', 'tel', 'fone']),
    endereco: findColumnIndex(['endereço', 'endereco', 'address']),
    cidade: findColumnIndex(['cidade', 'city']),
    uf: findColumnIndex(['uf', 'estado', 'state']),
    cpfCnpj: findColumnIndex(['cpf/cnpj', 'cpfcnpj', 'cnpj', 'cpf', 'documento']),
    site: findColumnIndex(['site', 'website', 'url']),
    situacao: findColumnIndex(['situação', 'situacao', 'status'])
  };

  console.log(`📊 Mapeamento de colunas:`, colIndices);

  // Processa dados
  const contactsMap = new Map<string, XLSXContactData>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as any[];
    if (!row || row.length === 0) continue;

    const getValue = (idx: number): string => {
      if (idx === -1 || !row[idx]) return '';
      return String(row[idx]).trim();
    };

    const nome = getValue(colIndices.nome);
    if (!nome) continue;

    // Parseia o nome no formato "Emissora | Dial | Cidade/UF"
    const parsed = parseXLSXNome(nome);

    const contact: XLSXContactData = {
      nome,
      email: getValue(colIndices.email),
      telefone: getValue(colIndices.telefone),
      endereco: getValue(colIndices.endereco),
      cidade: getValue(colIndices.cidade),
      uf: getValue(colIndices.uf),
      cpfCnpj: getValue(colIndices.cpfCnpj),
      site: getValue(colIndices.site),
      situacao: getValue(colIndices.situacao),
      ...parsed
    };

    // Gera chaves de busca (múltiplas para aumentar chance de match)
    const keys = generateMatchKeys(contact);
    keys.forEach(key => {
      if (key) contactsMap.set(key, contact);
    });
  }

  console.log(`✅ ${contactsMap.size} contatos carregados do XLSX`);
  return contactsMap;
}

/**
 * Parseia o nome no formato "Emissora | Dial | Cidade/UF"
 * Ex: "Melody | 94,1 | Ribeirão Preto/SP"
 * Ex: "013FM | 100,7 | Santos/SP"
 */
function parseXLSXNome(nome: string): { emissora?: string; dial?: string; cidadeNome?: string } {
  // Tenta parsear formato "Emissora | Dial | Cidade/UF"
  const parts = nome.split('|').map(p => p.trim());

  if (parts.length >= 3) {
    const emissora = parts[0] || '';
    const dial = (parts[1] || '').replace(',', '.'); // 94,1 -> 94.1
    const cidadeUf = parts[2] || '';
    const cidadeMatch = cidadeUf.match(/^(.+?)\/([A-Z]{2})$/i);

    return {
      emissora,
      dial,
      cidadeNome: cidadeMatch ? cidadeMatch[1] : cidadeUf
    };
  }

  // Tenta parsear formato sem pipes mas com dial
  const dialMatch = nome.match(/^(.+?)\s*\|\s*(\d+[,.]?\d*)/);
  if (dialMatch && dialMatch[1] && dialMatch[2]) {
    return {
      emissora: dialMatch[1].trim(),
      dial: dialMatch[2].replace(',', '.')
    };
  }

  return { emissora: nome };
}

/**
 * Gera múltiplas chaves de busca para matching
 */
function generateMatchKeys(contact: XLSXContactData): string[] {
  const keys: string[] = [];

  const normalize = (str: string): string => {
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  };

  const normalizeDial = (dial: string): string => {
    return dial.replace(',', '.').replace(/[^0-9.]/g, '');
  };

  // Chave 1: emissora + dial + uf (mais específica)
  if (contact.emissora && contact.dial && contact.uf) {
    keys.push(`${normalize(contact.emissora)}_${normalizeDial(contact.dial)}_${contact.uf.toLowerCase()}`);
  }

  // Chave 2: emissora + dial
  if (contact.emissora && contact.dial) {
    keys.push(`${normalize(contact.emissora)}_${normalizeDial(contact.dial)}`);
  }

  // Chave 3: emissora + cidade
  if (contact.emissora && contact.cidadeNome) {
    keys.push(`${normalize(contact.emissora)}_${normalize(contact.cidadeNome)}`);
  }

  // Chave 4: apenas emissora (menos específica)
  if (contact.emissora) {
    keys.push(normalize(contact.emissora));
  }

  return keys.filter(k => k.length > 0);
}

/**
 * Busca contato no XLSX pelo dados do TSV
 */
function findXLSXContact(
  contactsMap: Map<string, XLSXContactData>,
  emissora: string,
  dial: string,
  uf: string,
  cidade?: string
): XLSXContactData | null {
  const normalize = (str: string): string => {
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  };

  const normalizeDial = (dial: string): string => {
    return dial.replace(',', '.').replace(/[^0-9.]/g, '');
  };

  // Tenta as chaves na ordem de especificidade
  const keysToTry = [
    `${normalize(emissora)}_${normalizeDial(dial)}_${uf.toLowerCase()}`,
    `${normalize(emissora)}_${normalizeDial(dial)}`,
    cidade ? `${normalize(emissora)}_${normalize(cidade)}` : '',
    normalize(emissora)
  ].filter(k => k.length > 0);

  for (const key of keysToTry) {
    const contact = contactsMap.get(key);
    if (contact) {
      return contact;
    }
  }

  return null;
}

/**
 * Parseia endereço no formato "Rua X, 123 - Bairro - CEP: 12345-000"
 */
function parseEndereco(endereco: string): {
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  cep: string;
} {
  const result = {
    street: '',
    number: '',
    complement: '',
    neighborhood: '',
    cep: ''
  };

  if (!endereco) return result;

  // Extrai CEP
  const cepMatch = endereco.match(/CEP[:\s]*(\d{5}-?\d{3})/i);
  if (cepMatch && cepMatch[1]) {
    result.cep = cepMatch[1].replace('-', '');
    endereco = endereco.replace(cepMatch[0], '').trim();
  }

  // Remove "- CEP:" no final se sobrou
  endereco = endereco.replace(/\s*-\s*CEP\s*:?\s*$/i, '').trim();

  // Tenta parsear "Rua X, 123 - Bairro" ou "Rua X, 123 - COMPLEMENTO - Bairro"
  const parts = endereco.split(' - ').map(p => p.trim()).filter(p => p);

  if (parts.length >= 1) {
    // Primeira parte: "Rua X, 123" ou "Rua X, 123 - CONJUNTO 021"
    const streetPart = parts[0] || '';
    const streetMatch = streetPart.match(/^(.+?)[,\s]+(\d+[A-Za-z]?)(.*)$/);

    if (streetMatch && streetMatch[1] && streetMatch[2]) {
      result.street = streetMatch[1].trim();
      result.number = streetMatch[2].trim();
      if (streetMatch[3]) {
        result.complement = streetMatch[3].replace(/^[,\s-]+/, '').trim();
      }
    } else {
      result.street = streetPart;
    }
  }

  // Penúltimo ou último pode ser bairro
  if (parts.length >= 2) {
    // Se tem 3+ partes, a do meio pode ser complemento
    if (parts.length >= 3) {
      result.complement = result.complement
        ? `${result.complement} - ${parts.slice(1, -1).join(' - ')}`
        : parts.slice(1, -1).join(' - ');
    }
    result.neighborhood = parts[parts.length - 1] || '';
  }

  return result;
}

/**
 * Formata telefone removendo caracteres especiais
 */
function formatPhone(telefone: string): string {
  if (!telefone) return '00000000000';
  return telefone.replace(/\D/g, '') || '00000000000';
}

/**
 * Formata CNPJ removendo caracteres especiais
 */
function formatCNPJ(cnpj: string): string {
  if (!cnpj) return '';
  return cnpj.replace(/\D/g, '');
}

// ========================
// FUNÇÕES AUXILIARES TSV
// ========================

function detectDelimiter(firstLine: string): string {
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  return tabCount > commaCount ? '\t' : ',';
}

function parseCSVLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

function parseGender(genderStr: string): { male: number; female: number } {
  if (!genderStr) return { male: 50, female: 50 };

  const match = genderStr.match(/(\d+)%\s*(Fem|Masc|M|F)/i);
  if (match && match[1] && match[2]) {
    const percentage = parseInt(match[1]);
    const isFemale = /Fem|F/i.test(match[2]);

    if (isFemale) {
      return { male: 100 - percentage, female: percentage };
    } else {
      return { male: percentage, female: 100 - percentage };
    }
  }

  return { male: 50, female: 50 };
}

function parseCategories(styleStr: string): string[] {
  if (!styleStr) return [];
  return styleStr.split(/[,\/]/).map(s => s.trim()).filter(s => s.length > 0);
}

function parseCities(citiesStr: string): string[] {
  if (!citiesStr) return [];
  return citiesStr.split(' , ').map(s => s.trim()).filter(s => s.length > 0);
}

function determineBand(dial: string): string {
  if (!dial) return 'FM';
  const freq = parseFloat(dial);
  if (isNaN(freq)) return 'FM';
  if (freq >= 530 && freq <= 1700) return 'AM';
  return 'FM';
}

function generateUniqueEmail(emissora: string, uf: string, dial: string): string {
  const normalizedName = emissora
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 20);

  const normalizedDial = dial.replace('.', '');
  return `${normalizedName}.${normalizedDial}.${uf.toLowerCase()}@signalads.catalog.local`;
}

function generateCatalogId(): string {
  return `CATALOG-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

// ========================
// FUNÇÃO DE CONVERSÃO
// ========================

function rowToBroadcaster(
  columns: string[],
  index: number,
  adminId: string,
  xlsxContact: XLSXContactData | null
): any {
  const getValue = (idx: number): string => columns[idx]?.trim() || '';
  const getNumber = (idx: number): number => {
    const val = parseFloat(getValue(idx));
    return isNaN(val) ? 0 : val;
  };

  const emissora = getValue(COLUMN_INDICES.emissora);
  const uf = getValue(COLUMN_INDICES.uf);
  const dial = getValue(COLUMN_INDICES.dial);
  const praca = getValue(COLUMN_INDICES.praca);

  if (!emissora) return null;

  // Dados do XLSX (se encontrado)
  const hasXLSX = xlsxContact !== null;
  const xlsxEmail = xlsxContact?.email || '';
  const xlsxPhone = formatPhone(xlsxContact?.telefone || '');
  const xlsxCNPJ = formatCNPJ(xlsxContact?.cpfCnpj || '');
  const xlsxSite = xlsxContact?.site || '';
  const xlsxAddress = parseEndereco(xlsxContact?.endereco || '');
  const xlsxCidade = xlsxContact?.cidade || '';

  // Se não tiver email válido do XLSX, gera um placeholder
  const email = xlsxEmail && xlsxEmail.includes('@')
    ? xlsxEmail.toLowerCase()
    : generateUniqueEmail(emissora, uf, dial);

  // CNPJ: usa do XLSX ou gera ID catálogo
  const cnpj = xlsxCNPJ || generateCatalogId();

  // Telefone: usa do XLSX ou placeholder
  const phone = xlsxPhone || '00000000000';

  const band = determineBand(dial);
  const gender = parseGender(getValue(COLUMN_INDICES.genero));
  const categories = parseCategories(getValue(COLUMN_INDICES.estilo));
  const cities = parseCities(getValue(COLUMN_INDICES.pracasAbrangencia));
  const population = getNumber(COLUMN_INDICES.universo) || getNumber(COLUMN_INDICES.universo2);

  return {
    // Dados básicos
    email,
    password: '',
    userType: 'broadcaster',
    status: 'approved',
    cpfOrCnpj: cnpj,
    cnpj: cnpj,

    // Identificação
    companyName: emissora,
    fantasyName: emissora,
    phone,

    // Endereço - prioriza XLSX, fallback para TSV
    address: {
      cep: xlsxAddress.cep || '',
      street: xlsxAddress.street || '',
      number: xlsxAddress.number || '',
      complement: xlsxAddress.complement || '',
      neighborhood: xlsxAddress.neighborhood || '',
      city: xlsxCidade || praca,
      state: xlsxContact?.uf || uf
    },

    // Configurações de catálogo
    favorites: [],
    onboardingCompleted: true,
    isCatalogOnly: true,
    managedByAdmin: true,
    createdBy: adminId ? new mongoose.Types.ObjectId(adminId) : null,
    twoFactorEnabled: false,
    trustedDevices: [],

    // Perfil da emissora
    broadcasterProfile: {
      generalInfo: {
        stationName: emissora,
        dialFrequency: dial,
        band: band
      },
      logo: getValue(COLUMN_INDICES.logo) || '',
      comercialEmail: email,
      website: xlsxSite || '',
      socialMedia: {
        facebook: getValue(COLUMN_INDICES.facebook) || '',
        instagram: getValue(COLUMN_INDICES.instagram) || '',
        twitter: ''
      },
      categories: categories,
      audienceProfile: {
        gender: gender,
        ageRange: getValue(COLUMN_INDICES.idade) || '',
        socialClass: {
          classeAB: getNumber(COLUMN_INDICES.classeAB),
          classeC: getNumber(COLUMN_INDICES.classeC),
          classeDE: getNumber(COLUMN_INDICES.classeDE)
        }
      },
      coverage: {
        states: uf ? [uf] : [],
        cities: cities,
        totalPopulation: population,
        streamingUrl: ''
      },
      businessRules: {
        minCampaignDuration: 7,
        periodicity: 'diário',
        minInsertionsPerDay: 1,
        minAdvanceBooking: 3,
        maxAdvanceBooking: 90,
        paymentDeadline: 48,
        pricePerInsertion: getNumber(COLUMN_INDICES.avaliacaoComercial) || 0 // Usando avaliacaoComercial como preço base (30s)
      }
    },

    // Metadados extras
    _importMetadata: {
      rowId: getValue(COLUMN_INDICES.rowId),
      nomePmm: getValue(COLUMN_INDICES.nomePmm),
      classeAntena: getValue(COLUMN_INDICES.classeAntena),
      idAnatel: getValue(COLUMN_INDICES.idAnatel),
      caixaComercial: getNumber(COLUMN_INDICES.caixaComercial),
      avaliacaoComercial: getNumber(COLUMN_INDICES.avaliacaoComercial),
      avCs: getNumber(COLUMN_INDICES.avCs),
      comentarios: getValue(COLUMN_INDICES.comentarios),
      pracasAbrangenciaID: getValue(COLUMN_INDICES.pracasAbrangenciaID),
      kml: getValue(COLUMN_INDICES.kml),
      kml2: getValue(COLUMN_INDICES.kml2),
      kmz2: getValue(COLUMN_INDICES.kmz2),
      capa: getValue(COLUMN_INDICES.capa),
      audioRadio: getValue(COLUMN_INDICES.audioRadio),
      descricao: getValue(COLUMN_INDICES.descricao),
      xlsxMatched: hasXLSX,
      xlsxSituacao: xlsxContact?.situacao || '',
      importedAt: new Date().toISOString()
    }
  };
}

// ========================
// FUNÇÃO PRINCIPAL
// ========================

async function importBroadcasters(tsvPath: string, xlsxPath?: string, adminId?: string) {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('📻 IMPORTAÇÃO DE EMISSORAS - SignalAds');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`📁 Arquivo TSV: ${tsvPath}`);
  console.log(`📁 Arquivo XLSX: ${xlsxPath || '(não especificado)'}`);
  console.log(`👤 Admin ID: ${adminId || '(não especificado)'}`);
  console.log('');

  // Verifica arquivos
  if (!fs.existsSync(tsvPath)) {
    console.error(`❌ Arquivo TSV não encontrado: ${tsvPath}`);
    process.exit(1);
  }

  // Carrega XLSX (se fornecido)
  let contactsMap = new Map<string, XLSXContactData>();
  if (xlsxPath) {
    if (!fs.existsSync(xlsxPath)) {
      console.error(`❌ Arquivo XLSX não encontrado: ${xlsxPath}`);
      process.exit(1);
    }
    contactsMap = readXLSXContacts(xlsxPath);
  }

  // Conecta ao MongoDB
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Conectado ao MongoDB');
  } catch (error) {
    console.error('❌ Erro ao conectar ao MongoDB:', error);
    process.exit(1);
  }

  // Lê TSV
  const fileContent = fs.readFileSync(tsvPath, 'utf-8');
  const lines = fileContent.split('\n').filter(line => line.trim());

  if (lines.length < 2) {
    console.error('❌ Arquivo TSV vazio ou sem dados');
    process.exit(1);
  }

  const firstLine = lines[0] || '';
  const delimiter = detectDelimiter(firstLine);
  console.log(`📊 Delimitador TSV: ${delimiter === '\t' ? 'TAB' : 'VÍRGULA'}`);

  const header = parseCSVLine(firstLine, delimiter);
  console.log(`📋 Colunas TSV: ${header.length}`);
  console.log('');

  // Estatísticas
  const stats = {
    total: 0,
    success: 0,
    skipped: 0,
    errors: 0,
    duplicates: 0,
    xlsxMatched: 0,
    xlsxNotMatched: 0
  };

  const dataLines = lines.slice(1);
  stats.total = dataLines.length;

  console.log(`📊 Total de registros: ${stats.total}`);
  console.log('');
  console.log('Processando...');
  console.log('');

  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i] || '';
    const columns = parseCSVLine(line, delimiter);

    const emissora = columns[COLUMN_INDICES.emissora]?.trim() || '';
    const dial = columns[COLUMN_INDICES.dial]?.trim() || '';
    const uf = columns[COLUMN_INDICES.uf]?.trim() || '';

    // Busca no XLSX
    const xlsxContact = findXLSXContact(contactsMap, emissora, dial, uf);

    if (xlsxContact) {
      stats.xlsxMatched++;
    } else {
      stats.xlsxNotMatched++;
    }

    // Converte para objeto
    const broadcasterData = rowToBroadcaster(columns, i, adminId || '', xlsxContact);

    if (!broadcasterData) {
      console.log(`⏭️ Linha ${i + 2}: Ignorada (dados inválidos)`);
      stats.skipped++;
      continue;
    }

    try {
      // Verifica duplicados
      const existingByEmail = await User.findOne({ email: broadcasterData.email });
      if (existingByEmail) {
        console.log(`⚠️ Linha ${i + 2}: Email já existe (${broadcasterData.email})`);
        stats.duplicates++;
        continue;
      }

      const existingByCnpj = await User.findOne({ cpfOrCnpj: broadcasterData.cpfOrCnpj });
      if (existingByCnpj) {
        console.log(`⚠️ Linha ${i + 2}: CNPJ já existe (${broadcasterData.cpfOrCnpj})`);
        stats.duplicates++;
        continue;
      }

      // Gera senha
      const randomPassword = crypto.randomBytes(16).toString('hex');
      broadcasterData.password = await bcrypt.hash(randomPassword, 10);

      // Salva
      // Salva usuário
      const newBroadcaster = new User(broadcasterData);
      await newBroadcaster.save();

      // ===================================================================================
      // CRIAÇÃO AUTOMÁTICA DE PRODUTOS (spots)
      // Lógica de preço:
      // 1. Pega valor bruto da planilha (avaliacaoComercial)
      // 2. Aplica margem de +65% (x 1.65) -> Esse é o PREÇO BASE (30s)
      // 3. Deriva os outros formatos:
      //    - 60s = 30s * 2
      //    - 15s = 30s * 0.75
      //    - 5s  = 30s * 0.5
      // ===================================================================================

      const rawPrice = getNumber(COLUMN_INDICES.avaliacaoComercial) || 0;
      const basePrice = rawPrice * 1.65; // Aplica +65% de margem

      if (basePrice > 0) {
        // Funções helper para criar o produto
        const createSpot = async (name: string, duration: number, finalPrice: number, format: 'spot' | 'testemunhal') => {
          try {
            // Arredonda para 2 casas decimais
            const roundedPrice = Math.round(finalPrice * 100) / 100;

            const product = new Product({
              broadcasterId: newBroadcaster._id,
              spotType: name,
              duration: duration,
              format: format,
              pricePerInsertion: roundedPrice,
              timeSlot: 'Rotativo (06h às 19h)',
              programName: 'Programação Rotativa',
              description: `Inserção comercial de ${duration} segundos em horário rotativo.`,
              allowedSegments: ['all'],
              maxDuration: duration,
              isActive: true
            });
            await product.save();
          } catch (err) {
            console.error(`❌ Erro ao criar produto ${name} para ${broadcasterData.companyName}:`, err);
          }
        };

        // 1. Spot 30" (Base com +65%)
        await createSpot('Spot 30"', 30, basePrice, 'spot');

        // 2. Spot 60" (Dobro)
        await createSpot('Spot 60"', 60, basePrice * 2, 'spot');

        // 3. Spot 15" (75% do valor)
        await createSpot('Spot 15"', 15, basePrice * 0.75, 'spot');

        // 4. Spot 5" / Testemunhal (Metade do valor)
        await createSpot('Testemunhal 5"', 5, basePrice * 0.5, 'testemunhal');

        console.log(`   📦 Produtos criados. Base Planilha: R$ ${rawPrice} -> Base (+65%): R$ ${basePrice.toFixed(2)}`);
      }

      const matchIcon = xlsxContact ? '🔗' : '📝';
      console.log(`✅ Linha ${i + 2}: ${matchIcon} ${broadcasterData.companyName} (${broadcasterData.address?.state}) - ID: ${newBroadcaster._id}`);
      stats.success++;

    } catch (error: any) {
      console.error(`❌ Linha ${i + 2}: Erro - ${error.message}`);
      if (error.code === 11000) {
        stats.duplicates++;
      } else {
        stats.errors++;
      }
    }
  }

  // Resumo
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('📊 RESUMO DA IMPORTAÇÃO');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`📝 Total de registros:      ${stats.total}`);
  console.log(`✅ Importados com sucesso:   ${stats.success}`);
  console.log(`⏭️ Ignorados (inválidos):    ${stats.skipped}`);
  console.log(`⚠️ Duplicados:               ${stats.duplicates}`);
  console.log(`❌ Erros:                    ${stats.errors}`);
  console.log('');
  console.log('📋 CRUZAMENTO COM XLSX:');
  console.log(`🔗 Com dados do XLSX:        ${stats.xlsxMatched}`);
  console.log(`📝 Sem match no XLSX:        ${stats.xlsxNotMatched}`);
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('');

  await mongoose.disconnect();
  console.log('🔌 Desconectado do MongoDB');
  console.log('✨ Importação concluída!');
}

// ========================
// EXECUÇÃO
// ========================

const args = process.argv.slice(2);

if (args.length < 1) {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('📻 Script de Importação de Emissoras - SignalAds');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('USO:');
  console.log('  npx ts-node src/scripts/importBroadcastersFromSpreadsheet.ts <tsv> [xlsx] [adminId]');
  console.log('');
  console.log('PARÂMETROS:');
  console.log('  <tsv>       Arquivo TSV/CSV com dados principais das emissoras');
  console.log('  [xlsx]      (Opcional) Arquivo XLSX com dados complementares');
  console.log('  [adminId]   (Opcional) ID do admin que criará as emissoras');
  console.log('');
  console.log('EXEMPLOS:');
  console.log('  npx ts-node src/scripts/importBroadcastersFromSpreadsheet.ts ./emissoras.tsv');
  console.log('  npx ts-node src/scripts/importBroadcastersFromSpreadsheet.ts ./emissoras.tsv ./contatos.xlsx');
  console.log('  npx ts-node src/scripts/importBroadcastersFromSpreadsheet.ts ./emissoras.tsv ./contatos.xlsx 507f1f77bcf86cd799439011');
  console.log('');
  console.log('FORMATO DO TSV (dados principais):');
  console.log('  Row ID | classeAB | classeC | classeDE | ... | emissora | dial | ...');
  console.log('');
  console.log('FORMATO DO XLSX (dados complementares):');
  console.log('  Nome | E-mail | Telefone | Endereço | Cidade | UF | CPF/CNPJ | Site | Situação');
  console.log('  Nome no formato: "Emissora | Dial | Cidade/UF"');
  console.log('');
  console.log('CRUZAMENTO:');
  console.log('  O script cruza os dados pelo nome da emissora + dial + UF');
  console.log('  Prioriza dados do XLSX quando disponíveis (email, telefone, endereço, CNPJ)');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  process.exit(0);
}

const tsvPath = args[0] || '';
const xlsxPath = args[1] && !args[1].match(/^[a-f0-9]{24}$/i) ? args[1] : undefined;
const adminId = args[2] || (args[1] && args[1].match(/^[a-f0-9]{24}$/i) ? args[1] : undefined);

importBroadcasters(tsvPath, xlsxPath, adminId).catch(error => {
  console.error('❌ Erro fatal:', error);
  process.exit(1);
});
