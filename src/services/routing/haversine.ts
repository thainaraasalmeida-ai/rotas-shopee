import type { LatLng, MatrixProvider } from './types';

export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Estimativa em LINHA RETA (fallback sem internet/OSRM). NÃO considera sentido das vias.
 * Rotas calculadas com ela são rotuladas como "aproximadas", nunca como otimizadas pela malha viária.
 */
export const straightLine: MatrixProvider = {
  name: 'Linha reta (estimativa)',
  async matrix(points) {
    const speed = 25 / 3.6; // m/s
    const detour = 1.35;
    const distances = points.map((a) => points.map((b) => haversineMeters(a, b) * detour));
    const durations = distances.map((row) => row.map((d) => d / speed));
    return { durations, distances, method: 'linha-reta', provider: this.name };
  },
};
