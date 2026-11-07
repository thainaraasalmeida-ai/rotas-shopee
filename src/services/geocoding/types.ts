import type { Address, GeoPoint } from '../../domain/types';

/** Contrato para trocar o geocodificador (Nominatim hoje; Google/Mapbox/HERE no futuro). */
export interface GeocodingProvider {
  name: string;
  geocode(address: Address, signal?: AbortSignal): Promise<GeoPoint | null>;
}
