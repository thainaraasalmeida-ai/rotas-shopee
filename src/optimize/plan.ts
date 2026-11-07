import { effectiveAddress, normalizeStreet } from '../domain/address';
import { groupColorKey } from '../domain/colors';
import type { Group, RoutePlan, Stop } from '../domain/types';
import type { TravelMatrix } from '../services/routing/types';
import { splitIntoGroups } from './groups';
import { solveSequence, travelTime } from './sequence';

export interface PlanOptions {
  groupCount: number;
  /** Ordem importada (ids), para comparar e usar como semente. */
  importedOrder?: string[];
  /** Tempo do ponto de partida até cada parada localizada (mesma ordem de `located`). */
  fromStart?: number[];
}

/** Plano "como importado": mantém grupos e ordem do arquivo. Não é apresentado como otimizado. */
export function importedPlan(stops: Stop[], groups: Group[], groupCount: number): RoutePlan {
  const order = stops.map((s) => s.id);
  let gs = groups;
  if (!gs.length) {
    const per = Math.ceil(order.length / Math.max(1, groupCount));
    gs = [];
    for (let i = 0; i < order.length; i += per) {
      const idx = gs.length + 1;
      gs.push({ index: idx, colorKey: groupColorKey(idx), stopIds: order.slice(i, i + per) });
    }
  }
  return {
    method: 'importado',
    order,
    groups: gs,
    createdAt: Date.now(),
    notes: ['Ordem e grupos exatamente como no arquivo importado. Ainda não otimizada pela malha viária.'],
  };
}

/**
 * Gera o plano otimizado a partir de uma matriz de tempos sobre as paradas localizadas.
 * `located[i]` corresponde à linha/coluna i da matriz.
 */
export function optimizedPlan(stops: Stop[], located: Stop[], matrix: TravelMatrix, opts: PlanOptions): RoutePlan {
  const street = located.map((s) => normalizeStreet(effectiveAddress(s).street));
  const side = located.map((s) => s.dividerSide);
  const idxOf = new Map(located.map((s, i) => [s.id, i]));
  const seeds: number[][] = [];
  let importedSeconds: number | undefined;
  if (opts.importedOrder) {
    const seed = opts.importedOrder.map((id) => idxOf.get(id)).filter((i): i is number => i !== undefined);
    if (seed.length === located.length) {
      seeds.push(seed);
      importedSeconds = travelTime(seed, matrix.durations, opts.fromStart);
    }
  }
  const res = solveSequence({
    durations: matrix.durations,
    street,
    side: side.some((x) => x) ? side : undefined,
    houseNumber: located.map((s) => parseInt(effectiveAddress(s).number, 10) || 0),
    fromStart: opts.fromStart,
    seeds,
  });
  const orderedLocated = res.order.map((i) => located[i]);
  const unlocated = stops.filter((s) => !idxOf.has(s.id));
  const order = [...orderedLocated.map((s) => s.id), ...unlocated.map((s) => s.id)];

  // Cortes em grupos sobre a ordem global
  const posStops = [...orderedLocated, ...unlocated];
  const edgeSeconds: number[] = [];
  const sameStreet: boolean[] = [];
  const crossing: boolean[] = [];
  for (let i = 0; i < posStops.length - 1; i++) {
    const a = idxOf.get(posStops[i].id), b = idxOf.get(posStops[i + 1].id);
    edgeSeconds.push(a !== undefined && b !== undefined ? matrix.durations[a][b] : 600);
    sameStreet.push(normalizeStreet(effectiveAddress(posStops[i]).street) === normalizeStreet(effectiveAddress(posStops[i + 1]).street));
    const sa = posStops[i].dividerSide, sb = posStops[i + 1].dividerSide;
    crossing.push(!!sa && !!sb && sa !== sb);
  }
  const parts = splitIntoGroups({ packages: posStops.map((s) => s.packages.length), edgeSeconds, sameStreet, crossing, k: opts.groupCount });
  const groups: Group[] = parts.map((p, gi) => ({ index: gi + 1, colorKey: groupColorKey(gi + 1), stopIds: p.map((i) => posStops[i].id) }));

  const notes: string[] = [];
  if (matrix.method === 'malha-viaria') {
    notes.push(`Sequência calculada com matriz de tempos de carro pela malha viária (${matrix.provider}), que respeita mão única e conversões cadastradas no OpenStreetMap.`);
  } else {
    notes.push('ATENÇÃO: sem acesso ao serviço de rotas, foi usada estimativa em linha reta. Esta ordem é APROXIMADA e não considera sentido das vias.');
  }
  notes.push('Penalidades aplicadas: voltar a uma rua já iniciada e atravessar a avenida divisora.');
  if (unlocated.length) notes.push(`${unlocated.length} parada(s) sem localização ficaram no fim da rota. Corrija o endereço ou fixe a posição no mapa.`);
  const approx = located.filter((s) => s.geo && !s.geo.verified && s.geo.precision === 'rua').length;
  if (approx) notes.push(`${approx} parada(s) localizada(s) só pela rua (sem o número exato no mapa). A ordem dentro dessas ruas pode precisar de ajuste; fixe a posição pelo GPS na porta para melhorar as próximas rotas.`);

  return {
    method: matrix.method,
    order,
    groups,
    createdAt: Date.now(),
    totalSeconds: res.travelSeconds,
    importedSeconds,
    notes,
  };
}
