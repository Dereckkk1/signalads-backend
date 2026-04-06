import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../models/User';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || '';

// Busca uma emissora brasileira na API do radio-browser.info
const fetchStation = async () => {
  const url = 'https://de1.api.radio-browser.info/json/stations/search?country=Brazil&limit=1&hidebroken=true&order=clickcount&reverse=true&has_geo_info=true';
  const res = await fetch(url);
  const data = (await res.json()) as any[];
  if (!data || data.length === 0) throw new Error('Nenhuma emissora encontrada na API');
  return data[0];
};

// Mapeia os dados da API para o formato do User model
const mapStationToUser = (station: any) => {
  const name = station.name?.trim() || 'Emissora Desconhecida';

  // Extrai dial frequency do nome (ex: "101.7" de "Alpha FM 101.7 MHz")
  const dialMatch = name.match(/(\d{2,3}[.,]\d)/);
  const dial = dialMatch ? dialMatch[1].replace(',', '.') : '';

  // Determina banda FM/AM
  const nameLower = name.toLowerCase();
  const band = nameLower.includes('am') ? 'AM' : 'FM';

  // Categorias a partir das tags
  const categories = station.tags
    ? station.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
    : [];

  // Estado (normaliza "State of São Paulo" -> "São Paulo")
  const state = (station.state || '')
    .replace(/^State of\s+/i, '')
    .trim();

  // Email placeholder baseado no nome normalizado
  const normalized = name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
  const email = `radiobrowser_${normalized}@eradios.com.br`;

  const passwordHash = '$2a$10$RadioBrowserPlaceholderHashNotForLogin';

  return {
    userData: {
      name,
      email,
      userType: 'broadcaster' as const,
      status: 'approved' as const,
      cpfOrCnpj: `RB_${station.stationuuid}`,
      cnpj: `RB_${station.stationuuid}`,
      companyName: name,
      fantasyName: name,
      phone: '0000000000',
      address: {
        cep: '',
        street: '',
        number: '',
        complement: '',
        neighborhood: '',
        city: state, // API não tem cidade separada, usa state
        state,
        latitude: station.geo_lat || undefined,
        longitude: station.geo_long || undefined,
      },
      onboardingCompleted: true,
      broadcasterProfile: {
        generalInfo: {
          stationName: name,
          dialFrequency: dial,
          band,
        },
        logo: station.favicon || '',
        comercialEmail: email,
        website: station.homepage || '',
        categories,
        audienceProfile: {
          gender: { male: 50, female: 50 },
          ageRange: '',
          socialClass: { classeAB: 33, classeC: 34, classeDE: 33 },
        },
        coverage: {
          states: state ? [state] : [],
          cities: [],
          totalPopulation: 0,
          streamingUrl: station.url_resolved || station.url || '',
        },
      },
      twoFactorEnabled: false,
      isCatalogOnly: true,
      managedByAdmin: true,
      trustedDevices: [],
    },
    password: passwordHash,
  };
};

const run = async () => {
  try {
    console.log('Buscando emissora na API radio-browser.info...');
    const station = await fetchStation();
    console.log(`\nEmissora encontrada: ${station.name}`);
    console.log(`  País: ${station.country} | Estado: ${station.state}`);
    console.log(`  Tags: ${station.tags}`);
    console.log(`  Stream: ${station.url_resolved}`);
    console.log(`  Favicon: ${station.favicon}`);
    console.log(`  Coords: ${station.geo_lat}, ${station.geo_long}`);

    const { userData, password } = mapStationToUser(station);

    console.log('\nConectando ao MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('Conectado!');

    const result = await User.findOneAndUpdate(
      { email: userData.email },
      { $set: userData, $setOnInsert: { password } },
      { upsert: true, new: true, lean: true }
    );

    console.log('\nUsuário criado/atualizado com sucesso!');
    console.log(`  ID: ${result!._id}`);
    console.log(`  Nome: ${result!.name}`);
    console.log(`  Email: ${result!.email}`);
    console.log(`  Tipo: ${result!.userType}`);
    console.log(`  Status: ${result!.status}`);
    console.log(`  Catálogo: ${result!.isCatalogOnly}`);
    console.log(`  Streaming: ${result!.broadcasterProfile?.coverage?.streamingUrl}`);

    await mongoose.disconnect();
    console.log('\nDone!');
  } catch (err) {
    console.error('Erro:', err);
    await mongoose.disconnect();
    process.exit(1);
  }
};

run();
