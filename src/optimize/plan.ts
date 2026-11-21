import { effectiveAddress, normalizeStreet, streetKey } from '../domain/address';
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
  /** Pontos de coleta: entram na sequência, mas não no corte dos grupos comuns. */
  exclude?: string[];
  first?: string;
  last?: string[];
}

/** Plano "como importado": mantém grupos e ordem do arquivo. Não é apresentado como otimizado. */
export function importedPlan(stops: Stop[], groups: Group[], groupCount: number, exclude: string[] = []): RoutePlan {
  const order = stops.map((s) => s.id);
  let gs = groups;
  if (!gs.length) {
    stops = stops.filter((s) => !exclude.includes(s.id)); // pontos de coleta não entram no corte dos grupos comuns
    // Sem grupos no arquivo: corta a ordem do arquivo equilibrando PACOTES (não paradas) e sem partir uma rua.
    const parts = splitIntoGroups({
      packages: stops.map((s) => s.packages.length),
      edgeSeconds: stops.slice(1).map(() => 0),
      sameStreet: stops.slice(1).map((s, i) => normalizeStreet(effectiveAddress(s).street) === normalizeStreet(effectiveAddress(stops[i]).street)),
      crossing: stops.slice(1).map(() => false),
      k: groupCount,
    });
    gs = parts.map((p, i) => ({ index: i + 1, colorKey: groupColorKey(i + 1), stopIds: p.map((j) => stops[j].id) }));
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
  const street = located.map(stop => streetKey(effectiveAddress(stop)) + '|' + (stop.dividerSide ?? ''));
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
  const preferFirst = res.order.filter(i => located[i].id === opts.first);
  const remaining = res.order.filter(i => located[i].id !== opts.first);
  const last = new Set(opts.last);
  const orderIdx = [...preferFirst, ...remaining.filter(i => !last.has(located[i].id)), ...remaining.filter(i => last.has(located[i].id))];
  const orderedLocated = orderIdx.map((i) => located[i]);
  const unlocated = stops.filter((s) => !idxOf.has(s.id));
  const order = [...orderedLocated.map((s) => s.id), ...unlocated.map((s) => s.id)];

  // Cortes em grupos sobre a ordem global
  const posStops = [...orderedLocated, ...unlocated].filter((s) => !(opts.exclude ?? []).includes(s.id));
  const edgeSeconds: number[] = [];
  const sameStreet: boolean[] = [];
  const crossing: boolean[] = [];
  for (let i = 0; i < posStops.length - 1; i++) {
    const a = idxOf.get(posStops[i].id), b = idxOf.get(posStops[i + 1].id);
    edgeSeconds.push(a !== undefined && b !== undefined ? matrix.durations[a][b] : 600);
    const sa = posStops[i].dividerSide, sb = posStops[i + 1].dividerSide;
    sameStreet.push(streetKey(effectiveAddress(posStops[i])) === streetKey(effectiveAddress(posStops[i + 1])) && !(sa && sb && sa !== sb));
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
  if (side.includes(1) && side.includes(-1)) {
    const knownSides = orderedLocated.map(stop => stop.dividerSide).filter(Boolean);
    const changes = knownSides.slice(1).filter((value, index) => value !== knownSides[index]).length;
    notes.push(`Sequência estimada: ${changes} mudança(s) de lado entre paradas identificadas. Confira as travessias na navegação.`);
  } else {
    notes.push('O mapa não identificou entregas nos dois lados da avenida divisora. Confira as travessias no Waze.');
  }
  if (unlocated.length) notes.push(`${unlocated.length} parada(s) sem localização ficaram no fim da rota. Corrija o endereço ou fixe a posição no mapa.`);
  const approx = located.filter((s) => s.geo && !s.geo.verified && s.geo.precision === 'rua').length;
  if (approx) notes.push(`${approx} parada(s) localizada(s) só pela rua (sem o número exato no mapa). A ordem dentro dessas ruas pode precisar de ajuste; fixe a posição pelo GPS na porta para melhorar as próximas rotas.`);

  return {
    method: matrix.method,
    bagsByRoute: matrix.method === 'malha-viaria' && !unlocated.length,
    order,
    groups,
    createdAt: Date.now(),
    totalSeconds: travelTime(orderIdx, matrix.durations, opts.fromStart),
    firstSeconds: opts.fromStart && orderIdx.length ? opts.fromStart[orderIdx[0]] : undefined,
    legSeconds: Object.fromEntries(orderIdx.map((i, k) => [located[i].id, k === 0 ? (opts.fromStart?.[i] ?? 0) : matrix.durations[orderIdx[k - 1]][i]])),
    importedSeconds,
    notes,
  };
}
