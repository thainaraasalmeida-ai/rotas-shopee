import type { Group, Package, Stop } from '../domain/types';
import { canPrepareBags, pendingVisits, type Session } from '../store/store';
import { checkIntegrity } from './special';

export type LoadVisit = { stop:Stop; position:number; packages:Package[] };
export type LoadBag = { group:Group; visits:LoadVisit[] };

export function carLoading(session:Session):LoadBag[] {
  const {plan,stops} = session;
  if (!canPrepareBags(session)) throw new Error('Calcule o trajeto pelas ruas antes de separar os pacotes.');
  if (new Set(plan.order).size!==Object.keys(stops).length || plan.order.length!==Object.keys(stops).length ||
      plan.order.some(id=>!stops[id]) || !checkIntegrity(stops,plan.groups).ok) {
    throw new Error('Há paradas sem posição ou sacola única. Confira a rota antes de carregar.');
  }
  const bagFor = new Map(plan.groups.flatMap(group=>group.stopIds.map(id=>[id,group] as const)));
  const byGroup = new Map<Group, LoadBag>();
  let position=0;
  for (const id of pendingVisits(session)) {
    const stop=stops[id];
    const group=bagFor.get(id)!;
    const bag=byGroup.get(group) ?? {group,visits:[]};
    bag.visits.push({stop,position:++position,packages:stop.packages.filter(pkg=>pkg.status==='pending')});
    byGroup.set(group,bag);
  }
  return [...byGroup.values()].reverse();
}

export function cargoPosition(index:number,total:number) {
  if (index===total-1) return 'Perto da abertura';
  if (index===0) return 'No fundo do porta-malas';
  return `${index+1}ª a entrar, contando do fundo`;
}
