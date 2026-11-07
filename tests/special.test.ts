import { describe, expect, it } from 'vitest';
import { checkIntegrity, detectCollectionPoints, regroup } from '../src/optimize/special';
import type { Group, Stop } from '../src/domain/types';

const mk = (id: string, n: number, extra = 0): Stop => ({
  id, original: { street: 'Rua ' + id, number: '1', raw: '' }, complement: '', notes: '', propertyType: 'desconhecido', propertyTypeSource: 'nenhum', flags: [],
  packages: [
    ...Array.from({ length: n }, (_, i) => ({ id: `${id}-${i}`, label: `#${i}`, number: i, extra: false, status: 'pending' as const })),
    ...Array.from({ length: extra }, (_, i) => ({ id: `${id}-x${i}`, label: '+1', number: null, extra: true, status: 'pending' as const })),
  ],
});

describe('pontos de coleta', () => {
  const stops = [mk('a', 3), mk('b', 23, 1), mk('c', 2), mk('d', 5), mk('e', 4)];
  const rec = Object.fromEntries(stops.map((s) => [s.id, s]));
  const order = ['a', 'b', 'c', 'd', 'e'];
  const groups: Group[] = [
    { index: 1, colorKey: 'azul', stopIds: ['a', 'b'] },
    { index: 2, colorKey: 'verde', stopIds: ['c', 'd', 'e'] },
  ];

  it('detecta pelo limite e conta o +1', () => {
    expect(detectCollectionPoints(stops, 10)).toEqual(['b']);
    expect(rec.b.packages.length).toBe(24);
  });
  it('cria grupo exclusivo sem duplicar e mantém o total', () => {
    const g = regroup(order, groups, { b: 'auto' });
    expect(g.length).toBe(3);
    expect(g[0].stopIds).toEqual(['a']);
    expect(g[2]).toMatchObject({ index: 3, stopIds: ['b'], special: 'auto' });
    expect(['azul', 'verde']).not.toContain(g[2].colorKey);
    const i = checkIntegrity(rec, g);
    expect(i).toMatchObject({ ok: true, totalPackages: 38, groupedPackages: 38 });
  });
  it('desfazer devolve ao grupo do vizinho na rota', () => {
    const g1 = regroup(order, groups, { b: 'auto' });
    const g2 = regroup(order, g1, {});
    expect(g2.length).toBe(2);
    expect(g2[0].stopIds).toEqual(['a', 'b']);
    expect(checkIntegrity(rec, g2).ok).toBe(true);
  });
  it('grupo comum que fica vazio some e os índices se ajustam', () => {
    const g = regroup(order, [{ index: 1, colorKey: 'azul', stopIds: ['b'] }, { index: 2, colorKey: 'verde', stopIds: ['a', 'c', 'd', 'e'] }], { b: 'manual' });
    expect(g.map((x) => x.index)).toEqual([1, 2]);
    expect(g[1].special).toBe('manual');
  });
  it('detecta duplicidade', () => {
    expect(checkIntegrity(rec, [...groups, { index: 3, colorKey: 'preto', stopIds: ['b'] }]).ok).toBe(false);
  });
});
