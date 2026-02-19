/**
 * Utilitário para Geocodificação de Cidades
 * 
 * Este arquivo contém coordenadas das principais cidades brasileiras
 * e funções para adicionar lat/lng às cidades no perfil de cobertura.
 */

// Banco de dados de coordenadas de cidades brasileiras
export const brazilianCitiesCoordinates: Record<string, { lat: number; lng: number; state: string }> = {
  // Capitais
  'São Paulo': { lat: -23.5505, lng: -46.6333, state: 'SP' },
  'Rio de Janeiro': { lat: -22.9068, lng: -43.1729, state: 'RJ' },
  'Brasília': { lat: -15.7939, lng: -47.8828, state: 'DF' },
  'Salvador': { lat: -12.9714, lng: -38.5014, state: 'BA' },
  'Fortaleza': { lat: -3.7319, lng: -38.5267, state: 'CE' },
  'Belo Horizonte': { lat: -19.9167, lng: -43.9345, state: 'MG' },
  'Manaus': { lat: -3.1190, lng: -60.0217, state: 'AM' },
  'Curitiba': { lat: -25.4284, lng: -49.2733, state: 'PR' },
  'Recife': { lat: -8.0476, lng: -34.8770, state: 'PE' },
  'Goiânia': { lat: -16.6869, lng: -49.2648, state: 'GO' },
  'Belém': { lat: -1.4558, lng: -48.5039, state: 'PA' },
  'Porto Alegre': { lat: -30.0346, lng: -51.2177, state: 'RS' },
  'Guarulhos': { lat: -23.4538, lng: -46.5333, state: 'SP' },
  'Campinas': { lat: -22.9099, lng: -47.0626, state: 'SP' },
  'São Luís': { lat: -2.5307, lng: -44.3068, state: 'MA' },
  'São Gonçalo': { lat: -22.8268, lng: -43.0531, state: 'RJ' },
  'Maceió': { lat: -9.6658, lng: -35.7353, state: 'AL' },
  'Duque de Caxias': { lat: -22.7858, lng: -43.3055, state: 'RJ' },
  'Natal': { lat: -5.7945, lng: -35.2110, state: 'RN' },
  'Teresina': { lat: -5.0892, lng: -42.8034, state: 'PI' },
  'Campo Grande': { lat: -20.4486, lng: -54.6295, state: 'MS' },
  'Nova Iguaçu': { lat: -22.7592, lng: -43.4511, state: 'RJ' },
  'São Bernardo do Campo': { lat: -23.6914, lng: -46.5647, state: 'SP' },
  'João Pessoa': { lat: -7.1195, lng: -34.8450, state: 'PB' },
  'Santo André': { lat: -23.6639, lng: -46.5329, state: 'SP' },
  'Osasco': { lat: -23.5329, lng: -46.7919, state: 'SP' },
  'Jaboatão dos Guararapes': { lat: -8.1137, lng: -35.0147, state: 'PE' },
  'São José dos Campos': { lat: -23.1791, lng: -45.8872, state: 'SP' },
  'Ribeirão Preto': { lat: -21.1704, lng: -47.8103, state: 'SP' },
  'Uberlândia': { lat: -18.9186, lng: -48.2772, state: 'MG' },
  'Contagem': { lat: -19.9321, lng: -44.0537, state: 'MG' },
  'Sorocaba': { lat: -23.5015, lng: -47.4526, state: 'SP' },
  'Aracaju': { lat: -10.9472, lng: -37.0731, state: 'SE' },
  'Feira de Santana': { lat: -12.2664, lng: -38.9663, state: 'BA' },
  'Cuiabá': { lat: -15.6014, lng: -56.0979, state: 'MT' },
  'Joinville': { lat: -26.3045, lng: -48.8487, state: 'SC' },
  'Juiz de Fora': { lat: -21.7642, lng: -43.3502, state: 'MG' },
  'Londrina': { lat: -23.3045, lng: -51.1696, state: 'PR' },
  'Aparecida de Goiânia': { lat: -16.8173, lng: -49.2437, state: 'GO' },
  'Niterói': { lat: -22.8833, lng: -43.1036, state: 'RJ' },
  'Belford Roxo': { lat: -22.7642, lng: -43.3994, state: 'RJ' },
  'Caxias do Sul': { lat: -29.1634, lng: -51.1797, state: 'RS' },
  'Porto Velho': { lat: -8.7619, lng: -63.9039, state: 'RO' },
  'Macapá': { lat: 0.0349, lng: -51.0694, state: 'AP' },
  'Florianópolis': { lat: -27.5954, lng: -48.5480, state: 'SC' },
  'Vitória': { lat: -20.3155, lng: -40.3128, state: 'ES' },
  'Palmas': { lat: -10.1689, lng: -48.3317, state: 'TO' },
  'Boa Vista': { lat: 2.8235, lng: -60.6758, state: 'RR' },
  'Rio Branco': { lat: -9.9750, lng: -67.8243, state: 'AC' },

  // Outras cidades importantes
  'Santos': { lat: -23.9618, lng: -46.3322, state: 'SP' },
  'Jundiaí': { lat: -23.1864, lng: -46.8842, state: 'SP' },
  'Piracicaba': { lat: -22.7253, lng: -47.6492, state: 'SP' },
  'Bauru': { lat: -22.3147, lng: -49.0608, state: 'SP' },
  'Franca': { lat: -20.5386, lng: -47.4008, state: 'SP' },
  'São José do Rio Preto': { lat: -20.8197, lng: -49.3794, state: 'SP' },
  'Presidente Prudente': { lat: -22.1209, lng: -51.3889, state: 'SP' },
  'Araraquara': { lat: -21.7947, lng: -48.1758, state: 'SP' },
  'Limeira': { lat: -22.5647, lng: -47.4017, state: 'SP' },
  'Petrópolis': { lat: -22.5050, lng: -43.1789, state: 'RJ' },
  'Volta Redonda': { lat: -22.5231, lng: -44.0942, state: 'RJ' },
  'Pelotas': { lat: -31.7654, lng: -52.3376, state: 'RS' },
  'Canoas': { lat: -29.9177, lng: -51.1844, state: 'RS' },
  'Maringá': { lat: -23.4205, lng: -51.9333, state: 'PR' },
  'Foz do Iguaçu': { lat: -25.5163, lng: -54.5854, state: 'PR' },
  'Cascavel': { lat: -24.9558, lng: -53.4552, state: 'PR' },
  'Ponta Grossa': { lat: -25.0916, lng: -50.1668, state: 'PR' },
  'Blumenau': { lat: -26.9194, lng: -49.0661, state: 'SC' },
  'Chapecó': { lat: -27.0965, lng: -52.6151, state: 'SC' },
  'Vitória da Conquista': { lat: -14.8615, lng: -40.8442, state: 'BA' },
  'Caruaru': { lat: -8.2839, lng: -35.9761, state: 'PE' },
  'Petrolina': { lat: -9.3891, lng: -40.5030, state: 'PE' },
  'Mossoró': { lat: -5.1878, lng: -37.3444, state: 'RN' },
  'Imperatriz': { lat: -5.5264, lng: -47.4919, state: 'MA' },
  'Juazeiro do Norte': { lat: -7.2130, lng: -39.3151, state: 'CE' },
  'Sobral': { lat: -3.6861, lng: -40.3497, state: 'CE' },
  'Parnamirim': { lat: -5.9153, lng: -35.2628, state: 'RN' },
  'Montes Claros': { lat: -16.7350, lng: -43.8619, state: 'MG' },
  'Uberaba': { lat: -19.7472, lng: -47.9381, state: 'MG' },
  'Governador Valadares': { lat: -18.8511, lng: -41.9495, state: 'MG' },
  'Ipatinga': { lat: -19.4684, lng: -42.5369, state: 'MG' },
  'Sete Lagoas': { lat: -19.4658, lng: -44.2467, state: 'MG' },
  'Divinópolis': { lat: -20.1389, lng: -44.8839, state: 'MG' },
  'Santa Maria': { lat: -29.6842, lng: -53.8069, state: 'RS' },
  'Gravataí': { lat: -29.9436, lng: -50.9911, state: 'RS' },
  'Viamão': { lat: -30.0811, lng: -51.0233, state: 'RS' },
  'Novo Hamburgo': { lat: -29.6783, lng: -51.1306, state: 'RS' },
  'São Leopoldo': { lat: -29.7600, lng: -51.1472, state: 'RS' },
  'Alvorada': { lat: -29.9897, lng: -51.0822, state: 'RS' },
};

/**
 * Busca coordenadas de uma cidade
 */
export function getCityCoordinates(cityName: string): { lat: number; lng: number; state: string } | null {
  // Normaliza o nome da cidade (remove acentos e capitaliza)
  const normalizedName = cityName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

  // Tenta busca exata primeiro
  if (brazilianCitiesCoordinates[cityName]) {
    return brazilianCitiesCoordinates[cityName];
  }

  // Tenta com nome normalizado
  if (brazilianCitiesCoordinates[normalizedName]) {
    return brazilianCitiesCoordinates[normalizedName];
  }

  // Busca parcial (útil para nomes compostos)
  const partialMatch = Object.keys(brazilianCitiesCoordinates).find(key => 
    key.toLowerCase().includes(cityName.toLowerCase()) ||
    cityName.toLowerCase().includes(key.toLowerCase())
  );

  if (partialMatch && brazilianCitiesCoordinates[partialMatch]) {
    return brazilianCitiesCoordinates[partialMatch];
  }

  return null;
}

/**
 * Adiciona coordenadas a um array de cidades
 */
export function enrichCitiesWithCoordinates(cities: any[]): any[] {
  return cities.map(city => {
    if (city.lat && city.lng) {
      // Já tem coordenadas
      return city;
    }

    const coords = getCityCoordinates(city.name);
    
    if (coords) {
      return {
        ...city,
        lat: coords.lat,
        lng: coords.lng,
        state: city.state || coords.state,
      };
    }

    // Retorna sem coordenadas se não encontrou
    console.warn(`⚠️ Coordenadas não encontradas para: ${city.name}`);
    return city;
  });
}

/**
 * Valida se uma cidade tem coordenadas válidas
 */
export function hasValidCoordinates(city: any): boolean {
  return (
    city &&
    typeof city.lat === 'number' &&
    typeof city.lng === 'number' &&
    !isNaN(city.lat) &&
    !isNaN(city.lng) &&
    city.lat >= -90 &&
    city.lat <= 90 &&
    city.lng >= -180 &&
    city.lng <= 180
  );
}
