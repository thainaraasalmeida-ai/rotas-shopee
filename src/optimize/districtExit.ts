import { effectiveAddress, normalizeStreet } from '../domain/address';
import type { Group, Stop } from '../domain/types';

const districtOf = (st?: Stop) => (st ? normalizeStreet(effectiveAddress(st).district || '') : '');

/**
 * "Deixar para a saída deste bairro": leva a parada para o fim do trecho contínuo do mesmo bairro
 * em que ela estava, logo antes de a sequência seguir para o próximo bairro.
 * As sacolas continuam fatias consecutivas da sequência: a parada passa para a sacola da parada que fica antes dela.
 * A sacola exclusiva de ponto de coleta não muda.
 */
export function moveToDistrictExit(order: string[], groups: Group[], stops: Record<string, Stop>, stopId: string, pending: (id: string) => boolean = () => true) {
  const from = order.indexOf(stopId);
  if (from < 0) return null;
  const dist = districtOf(stops[stopId]);
  if (!dist) return null;
  const rest = order.filter(id => id !== stopId);
  const same = (i: number) => i >= 0 && i < rest.length && districtOf(stops[rest[i]]) === dist && pending(rest[i]);
  // trecho do bairro onde a parada estava: procura a partir da posição original
  let j = -1;
  for (let k = Math.min(from, rest.length - 1); k < rest.length; k++) if (same(k)) { j = k; break; }
  if (j < 0) for (let k = Math.min(from, rest.length) - 1; k >= 0; k--) if (same(k)) { j = k; break; }
  if (j < 0) return null; // única parada do bairro
  while (same(j + 1)) j++;
  const after = rest[j];
  const newOrder = [...rest.slice(0, j + 1), stopId, ...rest.slice(j + 1)];
  if (newOrder.join() === order.join()) return { order, groups, after, changed: false };
  const own = groups.find(g => g.stopIds.includes(stopId));
  const target = groups.find(g => g.stopIds.includes(after));
  const pos = new Map(newOrder.map((id, i) => [id, i]));
  const newGroups = groups.map(g => {
    let ids = g.stopIds;
    if (own && !own.special && target && !target.special && own !== target) {
      if (g === own) ids = ids.filter(id => id !== stopId);
      if (g === target) ids = [...ids, stopId];
    }
    return { ...g, stopIds: [...ids].sort((a, b) => (pos.get(a) ?? 0) - (pos.get(b) ?? 0)) };
  }).filter(g => g.stopIds.length);
  return { order: newOrder, groups: newGroups, after, changed: true };
}
