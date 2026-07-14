import NodeGeocoder from 'node-geocoder';

const geocoder = NodeGeocoder({ provider: 'openstreetmap' });

/**
 * Geocodifica uma cidade (Brasil) para coordenadas.
 *
 * Usado para preencher `User.address.latitude/longitude` das emissoras — base do
 * sort por proximidade do marketplace (ver `productController.getAllActiveProducts`).
 * A coordenada é o centroide da cidade (não do endereço exato), suficiente para
 * ordenação por distância entre cidades.
 *
 * Best-effort: retorna `null` se a cidade não vier, não for encontrada, ou em erro
 * (ex.: rate limit do Nominatim). Nunca lança.
 */
export async function geocodeCityCoords(
  city?: string,
  state?: string
): Promise<{ latitude: number; longitude: number } | null> {
  try {
    if (!city) return null;
    const query = state ? `${city}, ${state}, Brasil` : `${city}, Brasil`;
    const results = await geocoder.geocode(query);
    const first = results?.[0];
    if (first && first.latitude != null && first.longitude != null) {
      return { latitude: first.latitude, longitude: first.longitude };
    }
    return null;
  } catch {
    return null;
  }
}
