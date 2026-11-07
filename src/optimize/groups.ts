/**
 * Corta a ordem global em K grupos contíguos (para separar fisicamente no carro).
 * Prefere cortar em: saltos longos de deslocamento, travessias da avenida divisora e trocas de rua.
 * Evita cortar no meio de uma rua e equilibra a quantidade de pacotes.
 */
export interface SplitInput {
  packages: number[]; // pacotes por posição da ordem
  edgeSeconds: number[]; // tempo entre posição i e i+1 (length n-1)
  sameStreet: boolean[]; // posição i e i+1 na mesma rua
  crossing: boolean[]; // i -> i+1 atravessa a divisora
  k: number;
}

export function splitIntoGroups(inp: SplitInput): number[][] {
  const n = inp.packages.length;
  const k = Math.max(1, Math.min(inp.k, n));
  const prefix = [0];
  for (const p of inp.packages) prefix.push(prefix[prefix.length - 1] + p);
  const target = prefix[n] / k;
  const groupCost = (a: number, b: number) => {
    // posições [a, b)
    const pk = prefix[b] - prefix[a];
    const dev = (pk - target) / Math.max(1, target);
    return 900 * dev * dev;
  };
  const cutCost = (i: number) => {
    // corte entre i-1 e i
    const e = i - 1;
    let c = -Math.min(inp.edgeSeconds[e] ?? 0, 600);
    if (inp.crossing[e]) c -= 180;
    if (inp.sameStreet[e]) c += 400;
    return c;
  };
  const INF = 1e18;
  const f = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(INF));
  const from = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(-1));
  f[0][0] = 0;
  for (let g = 1; g <= k; g++) {
    for (let j = g; j <= n; j++) {
      for (let i = g - 1; i < j; i++) {
        if (f[g - 1][i] >= INF) continue;
        const v = f[g - 1][i] + groupCost(i, j) + (j < n ? cutCost(j) : 0);
        if (v < f[g][j]) { f[g][j] = v; from[g][j] = i; }
      }
    }
  }
  const bounds: number[] = [];
  let j = n;
  for (let g = k; g >= 1; g--) { bounds.unshift(j); j = from[g][j]; }
  const groups: number[][] = [];
  let a = 0;
  for (const b of bounds) { groups.push(Array.from({ length: b - a }, (_, x) => a + x)); a = b; }
  return groups.filter((g) => g.length);
}
