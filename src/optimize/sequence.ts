/**
 * Sequenciamento global das paradas (TSP assimétrico de caminho aberto).
 *
 * Custo = tempo de carro pela matriz (assimétrica → respeita mão única)
 *       + penalidade por voltar a uma rua já iniciada (incentiva concluir a rua de uma vez)
 *       + penalidade por atravessar a avenida divisora (incentiva terminar um lado antes do outro).
 *
 * Todas as paradas são consideradas ao mesmo tempo; os grupos são cortados DEPOIS, sobre esta ordem.
 */
export interface SequenceInput {
  durations: number[][]; // n x n, segundos
  street: string[]; // rua normalizada de cada nó
  side?: (number | undefined)[]; // lado da avenida divisora
  houseNumber?: number[]; // desempate dentro de mesmo ponto
  /** Duração do ponto de partida até cada nó (opcional). */
  fromStart?: number[];
  streetReentryPenalty?: number;
  crossingPenalty?: number;
  /** Ordem inicial opcional (ex.: ordem importada) para competir com a heurística. */
  seeds?: number[][];
}

export interface SequenceResult {
  order: number[];
  travelSeconds: number;
  cost: number;
}

export function travelTime(order: number[], d: number[][], fromStart?: number[]): number {
  let t = fromStart && order.length ? fromStart[order[0]] : 0;
  for (let i = 0; i < order.length - 1; i++) t += d[order[i]][order[i + 1]];
  return t;
}

export function makeCost(inp: SequenceInput) {
  const P = inp.streetReentryPenalty ?? 150;
  const Q = inp.crossingPenalty ?? 90;
  const { durations: d, side, fromStart } = inp;
  // ruas como inteiros para avaliar rápido (milhares de avaliações por segundo no celular)
  const ids = new Map<string, number>();
  const st = inp.street.map((s) => { if (!ids.has(s)) ids.set(s, ids.size); return ids.get(s)!; });
  const stamp = new Int32Array(ids.size);
  let gen = 0;
  return (order: number[]) => {
    gen++;
    let c = fromStart && order.length ? fromStart[order[0]] : 0;
    for (let i = 0; i < order.length; i++) {
      const o = order[i];
      if (i > 0) {
        const p = order[i - 1];
        c += d[p][o];
        if (side) { const a = side[p], b = side[o]; if (a && b && a !== b) c += Q; }
      }
      const s = st[o];
      if (i === 0 || st[order[i - 1]] !== s) {
        if (stamp[s] === gen) c += P;
        stamp[s] = gen;
      }
    }
    return c;
  };
}

function nearestNeighbor(n: number, d: number[][], start: number | null, fromStart?: number[]): number[] {
  const used = new Array(n).fill(false);
  const order: number[] = [];
  let cur = start;
  if (cur === null) {
    // começa no nó mais próximo do ponto de partida (ou 0)
    cur = 0;
    if (fromStart) cur = fromStart.indexOf(Math.min(...fromStart));
  }
  order.push(cur);
  used[cur] = true;
  while (order.length < n) {
    let best = -1, bd = Infinity;
    for (let j = 0; j < n; j++) if (!used[j] && d[cur][j] < bd) { bd = d[cur][j]; best = j; }
    order.push(best);
    used[best] = true;
    cur = best;
  }
  return order;
}

/** Busca local: Or-opt (move blocos de 1..4, também invertidos), 2-opt (inversão) e move a rua inteira. */
function improve(order: number[], cost: (o: number[]) => number, street: string[], maxPasses = 40): number[] {
  let best = order.slice();
  let bestC = cost(best);
  const n = best.length;
  const tryCand = (cand: number[]) => {
    const c = cost(cand);
    if (c < bestC - 1e-6) { best = cand; bestC = c; return true; }
    return false;
  };
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    for (let L = 1; L <= Math.min(4, n - 1); L++) {
      for (let i = 0; i + L <= n; i++) {
        const seg = best.slice(i, i + L);
        const rest = [...best.slice(0, i), ...best.slice(i + L)];
        for (let k = 0; k <= rest.length; k++) {
          if (k === i) continue;
          if (tryCand([...rest.slice(0, k), ...seg, ...rest.slice(k)])) { improved = true; break; }
          if (L > 1 && tryCand([...rest.slice(0, k), ...[...seg].reverse(), ...rest.slice(k)])) { improved = true; break; }
        }
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        if (tryCand([...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)])) improved = true;
      }
    }
    const streets = [...new Set(best.map((i) => street[i]))];
    for (const stName of streets) {
      const members = best.filter((i) => street[i] === stName);
      if (members.length < 2) continue;
      const rest = best.filter((i) => street[i] !== stName);
      for (let k = 0; k <= rest.length; k++) {
        if (tryCand([...rest.slice(0, k), ...members, ...rest.slice(k)])) improved = true;
        if (tryCand([...rest.slice(0, k), ...[...members].reverse(), ...rest.slice(k)])) improved = true;
      }
    }
    if (!improved) break;
  }
  return best;
}

export function solveSequence(inp: SequenceInput): SequenceResult {
  const n = inp.durations.length;
  if (n === 0) return { order: [], travelSeconds: 0, cost: 0 };
  if (n === 1) return { order: [0], travelSeconds: inp.fromStart?.[0] ?? 0, cost: 0 };
  const cost = makeCost(inp);
  const starts: (number | null)[] = inp.fromStart ? [null] : [];
  // Sem ponto de partida fixo: testa vários inícios
  if (!inp.fromStart) {
    const step = Math.max(1, Math.floor(n / 4));
    for (let s = 0; s < n; s += step) starts.push(s);
  }
  const candidates = starts.map((s) => nearestNeighbor(n, inp.durations, s, inp.fromStart));
  for (const seed of inp.seeds ?? []) if (seed.length === n) candidates.push(seed);
  let best: number[] | null = null;
  let bestC = Infinity;
  for (const c of candidates) {
    const o = improve(c, cost, inp.street, n > 150 ? 10 : 40);
    const v = cost(o);
    if (v < bestC) { bestC = v; best = o; }
  }
  return { order: best!, travelSeconds: travelTime(best!, inp.durations, inp.fromStart), cost: bestC };
}
