/**
 * Dados de Exemplo para Testes do Marketplace
 * 
 * Este arquivo contém dados de broadcaster com coordenadas para testar o mapa
 */

export const mockBroadcasterWithCoordinates = {
  _id: '123456789',
  name: 'Rádio Exemplo FM',
  dial: '98.5 FM',
  band: 'FM',
  location: 'São Paulo - SP',
  profile: {
    logo: 'https://via.placeholder.com/200x200?text=Radio+Exemplo',
    generalInfo: {
      foundationYear: 1985,
      website: 'https://radioexemplo.com.br',
      email: 'contato@radioexemplo.com.br',
      phone: '(11) 3333-4444',
      frequency: '98.5 MHz',
      power: '50 kW'
    },
    categories: ['Música', 'Notícias', 'Entretenimento', 'Esportes'],
    audienceProfile: {
      genderDistribution: {
        male: 48,
        female: 52
      },
      ageRanges: [
        { range: '18-24', percentage: 15 },
        { range: '25-34', percentage: 28 },
        { range: '35-44', percentage: 32 },
        { range: '45-54', percentage: 18 },
        { range: '55+', percentage: 7 }
      ],
      socialClasses: [
        { class: 'A', percentage: 22 },
        { class: 'B', percentage: 45 },
        { class: 'C', percentage: 28 },
        { class: 'D', percentage: 5 }
      ]
    },
    coverage: {
      totalPopulation: 21000000,
      streamingUrl: 'https://radioexemplo.com.br/ao-vivo',
      cities: [
        { name: 'São Paulo', population: 12300000, lat: -23.5505, lng: -46.6333, state: 'SP' },
        { name: 'Guarulhos', population: 1400000, lat: -23.4538, lng: -46.5333, state: 'SP' },
        { name: 'São Bernardo do Campo', population: 840000, lat: -23.6914, lng: -46.5647, state: 'SP' },
        { name: 'Santo André', population: 720000, lat: -23.6639, lng: -46.5329, state: 'SP' },
        { name: 'Osasco', population: 700000, lat: -23.5329, lng: -46.7919, state: 'SP' },
        { name: 'Campinas', population: 1200000, lat: -22.9099, lng: -47.0626, state: 'SP' },
        { name: 'São José dos Campos', population: 730000, lat: -23.1791, lng: -45.8872, state: 'SP' },
        { name: 'Santos', population: 430000, lat: -23.9618, lng: -46.3322, state: 'SP' },
        { name: 'Jundiaí', population: 420000, lat: -23.1864, lng: -46.8842, state: 'SP' },
        { name: 'Sorocaba', population: 680000, lat: -23.5015, lng: -47.4526, state: 'SP' }
      ]
    },
    businessRules: {
      minCampaignDuration: 7,
      periodicity: 'Diária',
      minInsertionsPerDay: 3,
      minAdvanceBooking: 5,
      cancellationDeadline: 48,
      pricing: {
        basePrice: 150,
        peakHourMultiplier: 1.5,
        offPeakDiscount: 0.7
      }
    }
  }
};

export const mockBroadcasterRioDeJaneiro = {
  _id: '987654321',
  name: 'Rádio Carioca FM',
  dial: '105.9 FM',
  band: 'FM',
  location: 'Rio de Janeiro - RJ',
  profile: {
    logo: 'https://via.placeholder.com/200x200?text=Radio+Carioca',
    generalInfo: {
      foundationYear: 1992,
      website: 'https://radiocarioca.com.br',
      email: 'contato@radiocarioca.com.br',
      phone: '(21) 3333-5555',
      frequency: '105.9 MHz',
      power: '30 kW'
    },
    categories: ['Música', 'Cultura', 'Notícias'],
    audienceProfile: {
      genderDistribution: {
        male: 45,
        female: 55
      },
      ageRanges: [
        { range: '18-24', percentage: 12 },
        { range: '25-34', percentage: 25 },
        { range: '35-44', percentage: 30 },
        { range: '45-54', percentage: 20 },
        { range: '55+', percentage: 13 }
      ],
      socialClasses: [
        { class: 'A', percentage: 18 },
        { class: 'B', percentage: 42 },
        { class: 'C', percentage: 32 },
        { class: 'D', percentage: 8 }
      ]
    },
    coverage: {
      totalPopulation: 12500000,
      streamingUrl: 'https://radiocarioca.com.br/ao-vivo',
      cities: [
        { name: 'Rio de Janeiro', population: 6700000, lat: -22.9068, lng: -43.1729, state: 'RJ' },
        { name: 'São Gonçalo', population: 1100000, lat: -22.8268, lng: -43.0531, state: 'RJ' },
        { name: 'Duque de Caxias', population: 920000, lat: -22.7858, lng: -43.3055, state: 'RJ' },
        { name: 'Nova Iguaçu', population: 820000, lat: -22.7592, lng: -43.4511, state: 'RJ' },
        { name: 'Niterói', population: 515000, lat: -22.8833, lng: -43.1036, state: 'RJ' },
        { name: 'Belford Roxo', population: 510000, lat: -22.7642, lng: -43.3994, state: 'RJ' },
        { name: 'Volta Redonda', population: 270000, lat: -22.5231, lng: -44.0942, state: 'RJ' },
        { name: 'Petrópolis', population: 306000, lat: -22.5050, lng: -43.1789, state: 'RJ' }
      ]
    },
    businessRules: {
      minCampaignDuration: 5,
      periodicity: 'Diária',
      minInsertionsPerDay: 4,
      minAdvanceBooking: 3,
      cancellationDeadline: 48,
      pricing: {
        basePrice: 120,
        peakHourMultiplier: 1.4,
        offPeakDiscount: 0.75
      }
    }
  }
};
