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
  // Coordenada conferida (GPS/mapa) ou coordenada própria da Shopee para este endereço.
  // Em 07/11 o endereço em texto levou o Waze ao lugar errado; por isso a coordenada da Shopee vem antes do texto.
  // Coordenada repetida para números diferentes ('aproximado') ou só da rua continua indo por endereço.
  if (g && (g.verified || g.precision === 'shopee') && Number.isFinite(g.lat) && Number.isFinite(g.lng) && Math.abs(g.lat) <= 90 && Math.abs(g.lng) <= 180 && (g.lat !== 0 || g.lng !== 0) && g.precision !== 'rua' && g.precision !== 'aproximado') {
    return {
      url: `https://waze.com/ul?ll=${g.lat.toFixed(6)},${g.lng.toFixed(6)}&navigate=yes`,
      mode: g.verified ? 'coordenada-verificada' : 'coordenada',
      hint: g.verified ? 'Waze pela posição conferida' : 'Waze pela coordenada da Shopee — confira o número na porta',
    };
  }
  return {
    url: `https://waze.com/ul?q=${encodeURIComponent(formatAddress(effectiveAddress(stop)))}&navigate=yes`,
    mode: 'endereco',
    hint: 'Confira rua, número e bairro no Waze antes de iniciar.',
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
