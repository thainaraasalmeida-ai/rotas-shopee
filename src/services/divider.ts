import type { LatLng } from './routing/types';

/** Geometria de uma avenida que divide regiões (ex.: Av. Fernando de Noronha). */
export interface DividerGeometry {
  name: string;
  lines: LatLng[][];
}

/** Busca a avenida no OpenStreetMap (Overpass API), dentro da área das entregas. */
export async function fetchDivider(name: string, bbox: { s: number; w: number; n: number; e: number }, signal?: AbortSignal): Promise<DividerGeometry | null> {
  const pad = 0.015;
  const box = `${bbox.s - pad},${bbox.w - pad},${bbox.n + pad},${bbox.e + pad}`;
  const safe = name.replace(/"/g, '');
  const q = `[out:json][timeout:25];way["highway"]["name"~"^${safe}$",i](${box});out geom;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: new URLSearchParams({ data: q }), signal });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const json = await res.json();
  const lines: LatLng[][] = (json.elements ?? [])
    .filter((e: { geometry?: unknown[] }) => Array.isArray(e.geometry) && e.geometry.length > 1)
    .map((e: { geometry: { lat: number; lon: number }[] }) => e.geometry.map((g) => ({ lat: g.lat, lng: g.lon })));
  if (!lines.length) return null;
  return { name, lines: orient(lines) };
}

/** Orienta todos os trechos no mesmo sentido (pistas de mão dupla vêm em sentidos opostos no OSM). */
function orient(lines: LatLng[][]): LatLng[][] {
  const first = lines[0];
  const ref = { x: first[first.length - 1].lng - first[0].lng, y: first[first.length - 1].lat - first[0].lat };
  return lines.map((l) => {
    const v = { x: l[l.length - 1].lng - l[0].lng, y: l[l.length - 1].lat - l[0].lat };
    return v.x * ref.x + v.y * ref.y < 0 ? [...l].reverse() : l;
  });
}

/** Lado do ponto em relação à avenida: +1 ou -1 (pelo trecho mais próximo); 0 = na própria avenida (< 35 m). */
export function sideOf(p: LatLng, d: DividerGeometry): number {
  let best = Infinity;
  let side = 0;
  for (const line of d.lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i];
      const b = line[i + 1];
      const abx = b.lng - a.lng, aby = b.lat - a.lat;
      const apx = p.lng - a.lng, apy = p.lat - a.lat;
      const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (abx * abx + aby * aby || 1)));
      const dx = apx - t * abx, dy = apy - t * aby;
      const dist = dx * dx + dy * dy;
      if (dist < best) {
        best = dist;
        const cross = abx * apy - aby * apx;
        side = cross >= 0 ? 1 : -1;
      }
    }
  }
  // distância aproximada em metros (graus → m na latitude local)
  const meters = Math.sqrt(best) * 111320;
  return meters < 35 ? 0 : side;
}
