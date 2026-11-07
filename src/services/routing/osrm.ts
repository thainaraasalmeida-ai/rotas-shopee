import type { MatrixProvider, TravelMatrix } from './types';

/**
 * Matriz de tempos via OSRM (perfil carro, dados do OpenStreetMap).
 * O perfil de carro do OSRM respeita "oneway" (mão única), proibições de conversão
 * marcadas no mapa e velocidades por tipo de via. O servidor público é para testes;
 * em produção, aponte `baseUrl` para um OSRM próprio.
 */
export function osrmProvider(baseUrl = 'https://router.project-osrm.org'): MatrixProvider {
  const CHUNK = 90;
  return {
    name: `OSRM (${new URL(baseUrl).host})`,
    async matrix(points, signal): Promise<TravelMatrix> {
      const n = points.length;
      const durations = Array.from({ length: n }, () => new Array<number>(n).fill(0));
      const distances = Array.from({ length: n }, () => new Array<number>(n).fill(0));
      // Divide em blocos para respeitar o limite de coordenadas por chamada.
      for (let si = 0; si < n; si += CHUNK) {
        for (let di = 0; di < n; di += CHUNK) {
          const src = range(si, Math.min(n, si + CHUNK));
          const dst = range(di, Math.min(n, di + CHUNK));
          const idx = [...new Set([...src, ...dst])];
          const coords = idx.map((i) => `${points[i].lng.toFixed(6)},${points[i].lat.toFixed(6)}`).join(';');
          const srcParam = src.map((i) => idx.indexOf(i)).join(';');
          const dstParam = dst.map((i) => idx.indexOf(i)).join(';');
          const url = `${baseUrl}/table/v1/driving/${coords}?annotations=duration,distance&sources=${srcParam}&destinations=${dstParam}`;
          const res = await fetch(url, { signal });
          if (!res.ok) throw new Error(`OSRM respondeu ${res.status}`);
          const json = await res.json();
          if (json.code !== 'Ok') throw new Error(`OSRM: ${json.message ?? json.code}`);
          src.forEach((i, a) =>
            dst.forEach((j, b) => {
              durations[i][j] = json.durations[a][b] ?? 1e6;
              distances[i][j] = json.distances?.[a]?.[b] ?? 0;
            }),
          );
        }
      }
      return { durations, distances, method: 'malha-viaria', provider: this.name };
    },
  };
}

function range(a: number, b: number) {
  return Array.from({ length: b - a }, (_, i) => a + i);
}
