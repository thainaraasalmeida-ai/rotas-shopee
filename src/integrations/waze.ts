import { effectiveAddress, formatAddress } from '../domain/address';
import type { Stop } from '../domain/types';

export interface WazeLink {
  url: string;
  mode: 'coordenada-verificada' | 'coordenada' | 'endereco';
  hint: string;
}

/**
 * Link universal do Waze (abre o app no iPhone/Android; no computador abre o site).
 * Coordenadas só são usadas quando apontam para o imóvel (número, GPS, manual ou Shopee).
 * Se só sabemos a rua, enviamos o endereço em texto para o próprio Waze localizar o número.
 * O Waze NÃO devolve confirmação de chegada/entrega para este app.
 */
export function wazeLink(stop: Stop): WazeLink {
  const g = stop.geo;
  if (g && g.precision !== 'rua' && g.precision !== 'aproximado') {
    return {
      url: `https://waze.com/ul?ll=${g.lat.toFixed(6)},${g.lng.toFixed(6)}&navigate=yes`,
      mode: g.verified ? 'coordenada-verificada' : 'coordenada',
      hint: 'Waze por coordenada',
    };
  }
  return {
    url: `https://waze.com/ul?q=${encodeURIComponent(formatAddress(effectiveAddress(stop)))}&navigate=yes`,
    mode: 'endereco',
    hint: 'Waze pelo endereço',
  };
}

/** Alternativa ao Waze: Google Maps com rota de carro até a parada. */
export function googleMapsLink(stop: Stop): string {
  const g = stop.geo;
  const dest = g && g.precision !== 'rua' && g.precision !== 'aproximado'
    ? `${g.lat.toFixed(6)},${g.lng.toFixed(6)}`
    : formatAddress(effectiveAddress(stop));
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=driving`;
}
