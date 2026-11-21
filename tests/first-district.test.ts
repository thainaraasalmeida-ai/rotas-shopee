import { expect, it } from 'vitest';
import { optimizedPlan } from '../src/optimize/plan';
import type { Stop } from '../src/domain/types';

const st = (id: string, district: string, x: number) => ({ id, original: { street: 'Rua ' + id, number: String(x), district, city: 'Ipatinga' }, packages: [{ id: id + 'p', label: '#' + x, status: 'pending' }], geo: { lat: 0, lng: x, precision: 'shopee' } }) as unknown as Stop;
// Cariru perto da saída (x pequeno), Centro longe (x grande): sem preferência, a rota começaria pelo Cariru.
const stops = [st('c1', 'Cariru', 1), st('c2', 'Cariru', 2), st('c3', 'Cariru', 3), st('z1', 'Centro', 10), st('z2', 'centro ipatinga', 11), st('z3', 'Centro', 12)];
const durations = stops.map(a => stops.map(b => Math.abs(a.geo!.lng - b.geo!.lng) * 60));
const fromStart = stops.map(s => s.geo!.lng * 60);

it('sem preferência começa pelo mais perto', () => {
  const p = optimizedPlan(stops, stops, { durations, method: 'malha-viaria', provider: 't' }, { groupCount: 2, fromStart });
  expect(p.order[0]).toBe('c1');
});
it('Começar por este bairro: todo o Centro antes, incluindo as variações do nome', () => {
  const p = optimizedPlan(stops, stops, { durations, method: 'malha-viaria', provider: 't' }, { groupCount: 2, fromStart, firstDistrict: 'Centro' });
  expect(p.order.slice(0, 3).sort()).toEqual(['z1', 'z2', 'z3']);
  expect(p.order[0]).toBe('z1'); // entra no Centro pelo lado mais perto
  expect(p.order.slice(3)).toEqual(['c3', 'c2', 'c1']); // volta pelo Cariru sem ir e voltar
});
