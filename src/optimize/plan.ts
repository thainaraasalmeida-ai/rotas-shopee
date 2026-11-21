import { effectiveAddress, normalizeStreet, streetKey } from '../domain/address';
import { groupColorKey } from '../domain/colors';
import type { Group, RegionCheck, RoutePlan, Stop } from '../domain/types';
import type { TravelMatrix } from '../services/routing/types';
import { splitIntoGroups } from './groups';
import { solveSequence, travelTime } from './sequence';

export interface PlanOptions {
  groupCount: number;
  /** Ordem importada (ids), para comparar e usar como semente. */
  importedOrder?: string[];
  /** Tempo do ponto de partida até cada parada localizada (mesma ordem de `located`). */
  fromStart?: number[];
  fromStartMeters?: number[];
  /** Bairro para atender antes de todos (ex.: Centro, comércio que fecha cedo). */
  firstDistrict?: string;
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
  if (opts.firstDistrict) {
    // "Começar por este bairro": resolve primeiro as paradas do bairro (a partir da saída) e depois o resto,
    // a partir da última parada do bairro. Cada parte usa a matriz de carro.
    const key = normalizeStreet(opts.firstDistrict);
    const inDist = (i: number) => { const d = normalizeStreet(effectiveAddress(located[i]).district || ''); return d === key || d.startsWith(key + ' '); };
    const A = located.map((_, i) => i).filter(inDist);
    const B = located.map((_, i) => i).filter(i => !inDist(i));
    if (A.length && B.length) {
      const sub = (ids: number[], from?: number[]) => {
        const r = solveSequence({ durations: ids.map(a => ids.map(b => matrix.durations[a][b])), street: ids.map(i => street[i]), houseNumber: ids.map(i => parseInt(effectiveAddress(located[i]).number, 10) || 0), fromStart: from });
        return r.order.map(k => ids[k]);
      };
      const oa = sub(A, opts.fromStart ? A.map(i => opts.fromStart![i]) : undefined);
      const lastA = oa[oa.length - 1];
      const ob = sub(B, B.map(i => matrix.durations[lastA][i]));
      res.order = [...oa, ...ob];
    }
  }
  const preferFirst = res.order.filter(i => located[i].id === opts.first);
  const remaining = res.order.filter(i => located[i].id !== opts.first);
  const last = new Set(opts.last);
  const orderIdx = [...preferFirst, ...remaining.filter(i => !last.has(located[i].id)), ...remaining.filter(i => last.has(located[i].id))];
  const region = regionTransitions(orderIdx, located, matrix, opts, last);
  orderIdx.splice(0, orderIdx.length, ...region.order);
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
  for (const c of region.checks) {
    const st = located.find(x => x.id === c.stopId)!; const a = effectiveAddress(st);
    const nx = c.nextId ? effectiveAddress(located.find(x => x.id === c.nextId)!) : undefined;
    const f = (x: { seconds: number; meters: number }) => `${(x.seconds / 60).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} min · ${(x.meters / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
    notes.push(`Saída de ${c.district}: ${a.street}, ${a.number} ficou na ${c.position}ª parada, antes de ${nx ? `${nx.street}, ${nx.number} (${c.nextDistrict})` : 'o próximo bairro'}. Rota inteira: na saída ${f(c.exit)}; na chegada ${f(c.arrival)}.`);
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
    regionChecks: region.checks,
    firstSeconds: opts.fromStart && orderIdx.length ? opts.fromStart[orderIdx[0]] : undefined,
    legSeconds: Object.fromEntries(orderIdx.map((i, k) => [located[i].id, k === 0 ? (opts.fromStart?.[i] ?? 0) : matrix.durations[orderIdx[k - 1]][i]])),
    importedSeconds,
    notes,
  };
}

const TIE_SECONDS = 15;

/** Rota inteira (saída → todas as paradas): tempo, distância e quantas vezes volta a uma rua já deixada. */
function routeCost(order: number[], m: TravelMatrix, fromStart?: number[], fromStartM?: number[], street?: string[]) {
  let sec = fromStart && order.length ? fromStart[order[0]] : 0;
  let met = fromStartM && order.length ? fromStartM[order[0]] : 0;
  for (let i = 0; i < order.length - 1; i++) { sec += m.durations[order[i]][order[i + 1]]; met += m.distances?.[order[i]]?.[order[i + 1]] ?? 0; }
  let repeats = 0;
  if (street) { const left = new Set<string>(); for (let i = 1; i < order.length; i++) { const a = street[order[i - 1]], b = street[order[i]]; if (a !== b) { left.add(a); if (left.has(b)) repeats++; } } }
  return { seconds: sec, meters: met, repeats };
}

/**
 * Transições entre bairros: para cada trecho contínuo de um bairro, compara atender a parada da ponta
 * na chegada ou na saída (a caminho do próximo bairro), sempre medindo a rota INTEIRA pela matriz de carro
 * (mão única e conversões já estão na matriz). Fica a de menor tempo; empate (até 15 s) → a que repete menos ruas.
 */
function regionTransitions(order: number[], located: Stop[], m: TravelMatrix, opts: PlanOptions, last: Set<string | undefined>) {
  const dist = located.map(st => normalizeStreet(effectiveAddress(st).district || ''));
  const street = located.map(st => streetKey(effectiveAddress(st)));
  const fixed = (i: number) => last.has(located[i].id) || located[i].id === opts.first;
  let cur = [...order];
  const checks: RegionCheck[] = [];
  const runs = () => { const r: [number, number][] = []; let a = 0; for (let i = 1; i <= cur.length; i++) if (i === cur.length || dist[cur[i]] !== dist[cur[a]]) { r.push([a, i - 1]); a = i; } return r; };
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const [a, b] of runs()) {
      if (b - a < 1 || !dist[cur[a]] || b === cur.length - 1) continue; // precisa de transição para outro bairro
      // candidatas: a parada da chegada (vai para a saída) e a da saída (vai para a chegada)
      for (const [fromPos, toPos] of [[a, b], [b, a]] as const) {
        const idx = cur[fromPos];
        if (fixed(idx)) continue;
        const moved = [...cur]; moved.splice(fromPos, 1); moved.splice(toPos, 0, idx);
        const now = routeCost(cur, m, opts.fromStart, opts.fromStartMeters, street);
        const alt = routeCost(moved, m, opts.fromStart, opts.fromStartMeters, street);
        const better = alt.seconds < now.seconds - TIE_SECONDS || (Math.abs(alt.seconds - now.seconds) <= TIE_SECONDS && alt.repeats < now.repeats);
        if (better) { cur = moved; changed = true; break; }
      }
    }
    if (!changed) break;
  }
  // registro: para cada saída de bairro, a comparação chegada × saída da parada que ficou na ponta de saída
  for (const [a, b] of runs()) {
    if (b - a < 1 || !dist[cur[a]] || b === cur.length - 1) continue;
    const idx = cur[b];
    const arrivalOrder = [...cur]; arrivalOrder.splice(b, 1); arrivalOrder.splice(a, 0, idx);
    const exit = routeCost(cur, m, opts.fromStart, opts.fromStartMeters, street);
    const arrival = routeCost(arrivalOrder, m, opts.fromStart, opts.fromStartMeters, street);
    checks.push({ stopId: located[idx].id, district: effectiveAddress(located[idx]).district ?? '', nextId: located[cur[b + 1]]?.id, nextDistrict: effectiveAddress(located[cur[b + 1]]).district, exit, arrival, chosen: 'saida', position: b + 1 });
  }
  return { order: cur, checks };
}
