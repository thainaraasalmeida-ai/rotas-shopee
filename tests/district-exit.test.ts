import { expect, it } from 'vitest';
import { moveToDistrictExit } from '../src/optimize/districtExit';
import type { Group, Stop } from '../src/domain/types';

const st = (id: string, district: string) => ({ id, original: { street: 'Rua ' + id, number: '1', district }, packages: [{ id: id + 'p', status: 'pending' }] }) as unknown as Stop;
const stops = Object.fromEntries([st('k', 'Cariru'), st('i1', 'Cariru'), st('i2', 'Cariru'), st('i3', 'Cariru'), st('a1', 'Águas'), st('a2', 'Águas')].map(s => [s.id, s]));
const groups: Group[] = [
  { index: 1, colorKey: 'azul', stopIds: ['k', 'i1'] },
  { index: 2, colorKey: 'verde', stopIds: ['i2', 'i3', 'a1'] },
  { index: 3, colorKey: 'laranja', stopIds: ['a2'] },
];

it('leva a parada para o fim do trecho do bairro e para a sacola certa', () => {
  const r = moveToDistrictExit(['k', 'i1', 'i2', 'i3', 'a1', 'a2'], groups, stops, 'k')!;
  expect(r.order).toEqual(['i1', 'i2', 'i3', 'k', 'a1', 'a2']);
  expect(r.after).toBe('i3');
  expect(r.groups.find(g => g.index === 2)!.stopIds).toEqual(['i2', 'i3', 'k', 'a1']);
  expect(r.groups.find(g => g.index === 1)!.stopIds).toEqual(['i1']);
  // cada sacola continua um trecho consecutivo
  const flat = r.groups.flatMap(g => g.stopIds);
  expect(flat).toEqual(r.order);
});
it('não mexe na sacola de ponto de coleta', () => {
  const g2: Group[] = [{ index: 1, colorKey: 'azul', stopIds: ['i1', 'i2', 'i3', 'a1', 'a2'] }, { index: 9, colorKey: 'cinza', stopIds: ['k'], special: 'auto' } as Group];
  const r = moveToDistrictExit(['k', 'i1', 'i2', 'i3', 'a1', 'a2'], g2, stops, 'k')!;
  expect(r.groups.find(g => g.index === 9)!.stopIds).toEqual(['k']);
});
