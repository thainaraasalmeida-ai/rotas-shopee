import { DEFAULT_REGION, normalizeStreet } from '../../domain/address';
import type { Address, GeoPoint } from '../../domain/types';
import type { GeocodingProvider } from './types';

const BASE = 'https://nominatim.openstreetmap.org/search';
// Política de uso do Nominatim: no máximo 1 requisição por segundo.
const MIN_INTERVAL = 1100;
let last = 0;
async function throttle() {
  const wait = last + MIN_INTERVAL - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
}

interface NomResult {
  lat: string;
  lon: string;
  display_name: string;
  category?: string;
  class?: string;
  type?: string;
  address?: { house_number?: string; road?: string; suburb?: string; neighbourhood?: string; city?: string; town?: string };
}

async function query(params: Record<string, string>, signal?: AbortSignal): Promise<NomResult[]> {
  await throttle();
  const url = `${BASE}?${new URLSearchParams({ format: 'jsonv2', addressdetails: '1', limit: '5', countrycodes: 'br', 'accept-language': 'pt-BR', ...params })}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return res.json();
}

function pick(results: NomResult[], a: Address): GeoPoint | null {
  const want = normalizeStreet(a.street).replace(/^(rua|avenida) /, '');
  const sameStreet = results.filter((r) => r.address?.road && normalizeStreet(r.address.road).includes(want));
  const exact = sameStreet.find((r) => r.address?.house_number && r.address.house_number.replace(/\D/g, '') === a.number.replace(/\D/g, ''));
  const best = exact ?? sameStreet[0];
  if (!best) return null;
  return {
    lat: parseFloat(best.lat),
    lng: parseFloat(best.lon),
    precision: exact ? 'numero' : 'rua',
    verified: false,
    source: 'OpenStreetMap (Nominatim)',
    displayName: best.display_name,
  };
}

export const nominatim: GeocodingProvider = {
  name: 'OpenStreetMap / Nominatim',
  async geocode(a, signal) {
    const city = a.city || DEFAULT_REGION.city;
    const state = a.state || DEFAULT_REGION.state;
    const structured = await query({ street: `${a.number} ${a.street}`.trim(), city, state, country: 'Brasil' }, signal);
    let hit = pick(structured, a);
    if (hit?.precision === 'numero') return hit;
    const free = await query({ q: `${a.street}, ${a.number}, ${a.district || DEFAULT_REGION.district}, ${city} - ${state}` }, signal);
    const hit2 = pick(free, a);
    if (hit2 && (!hit || hit2.precision === 'numero')) hit = hit2;
    return hit;
  },
};
