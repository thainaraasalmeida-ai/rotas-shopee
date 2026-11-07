import { groupColorKey, SPECIAL_COLOR_KEYS } from '../domain/colors';
import type { Group, Stop } from '../domain/types';

export type SpecialKind = 'auto' | 'manual';

/** Endereços com pacotes >= limite viram ponto de coleta (exceto os que o usuário recusou). */
export function detectCollectionPoints(stops: Stop[], threshold: number, declined: string[] = []): string[] {
  return stops.filter((s) => s.packages.length >= threshold && !declined.includes(s.id)).map((s) => s.id);
}

/**
 * Refaz os grupos de separação a partir dos grupos atuais:
 * - tira os pontos de coleta dos grupos comuns (sem duplicar);
 * - devolve ao grupo do vizinho anterior na rota um endereço que deixou de ser especial;
 * - cria um grupo exclusivo por ponto de coleta, com cor reservada.
 * A ORDEM DE VISITA (order) não muda: o ponto de coleta continua na posição mais eficiente da rota.
 */
export function regroup(order: string[], groups: Group[], specials: Record<string, SpecialKind>): Group[] {
  const pos = new Map(order.map((id, i) => [id, i]));
  const isSpecial = (id: string) => id in specials;
  const regular = groups
    .filter((g) => !g.special)
    .map((g) => ({ ...g, stopIds: g.stopIds.filter((id) => !isSpecial(id) && pos.has(id)) }));
  const assigned = new Set(regular.flatMap((g) => g.stopIds));
  for (const id of order) {
    if (isSpecial(id) || assigned.has(id)) continue;
    let target: Group | undefined;
    const i = pos.get(id)!;
    for (let k = i - 1; k >= 0 && !target; k--) target = regular.find((g) => g.stopIds.includes(order[k]));
    for (let k = i + 1; k < order.length && !target; k++) target = regular.find((g) => g.stopIds.includes(order[k]));
    if (!target) { target = { index: 1, colorKey: groupColorKey(1), stopIds: [] }; regular.push(target); }
    target.stopIds.push(id);
    target.stopIds.sort((a, b) => pos.get(a)! - pos.get(b)!);
    assigned.add(id);
  }
  const kept = regular.filter((g) => g.stopIds.length).map((g, i) => ({ ...g, index: i + 1, colorKey: groupColorKey(i + 1) }));
  const used = new Set(kept.map((g) => g.colorKey));
  const palette = [...SPECIAL_COLOR_KEYS.filter((c) => !used.has(c)), ...SPECIAL_COLOR_KEYS];
  const specialIds = order.filter(isSpecial);
  const special: Group[] = specialIds.map((id, i) => ({
    index: kept.length + i + 1,
    colorKey: palette[i % palette.length],
    name: 'Ponto de coleta',
    stopIds: [id],
    special: specials[id],
  }));
  return [...kept, ...special];
}

export interface Integrity {
  ok: boolean;
  totalPackages: number;
  groupedPackages: number;
  groups: number;
  duplicates: string[]; // stopIds em mais de um grupo
  missing: string[]; // stopIds sem grupo
}

/** Soma dos pacotes de todos os grupos = total da rota, sem endereço repetido nem faltando. */
export function checkIntegrity(stops: Record<string, Stop>, groups: Group[]): Integrity {
  const count = new Map<string, number>();
  for (const g of groups) for (const id of g.stopIds) count.set(id, (count.get(id) ?? 0) + 1);
  const duplicates = [...count].filter(([, c]) => c > 1).map(([id]) => id);
  const missing = Object.keys(stops).filter((id) => !count.has(id));
  const totalPackages = Object.values(stops).reduce((s, x) => s + x.packages.length, 0);
  const groupedPackages = groups.reduce((s, g) => s + g.stopIds.reduce((n, id) => n + (stops[id]?.packages.length ?? 0), 0), 0);
  return { ok: !duplicates.length && !missing.length && groupedPackages === totalPackages, totalPackages, groupedPackages, groups: groups.length, duplicates, missing };
}
