import { describe, expect, it } from 'vitest';
import { solveSequence, travelTime } from '../src/optimize/sequence';
import { splitIntoGroups } from '../src/optimize/groups';
import { auditLeaving } from '../src/audit/audit';
import type { Stop } from '../src/domain/types';

function grid(n: number) {
  // pontos em linha com uma "mão única": ir de i para i-1 custa muito mais
  const d = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (j >= i ? (j - i) * 30 : (i - j) * 30 + 400)));
  return d;
}

describe('sequenciamento', () => {
  it('respeita assimetria (mão única)', () => {
    const d = grid(8);
    const shuffled = [5, 2, 7, 0, 3, 6, 1, 4];
    const res = solveSequence({ durations: d, street: d.map(() => 'a'), seeds: [shuffled] });
    expect(res.order).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(res.travelSeconds).toBeLessThan(travelTime(shuffled, d));
  });
  it('evita voltar à mesma rua', () => {
    // A0 A1 | B0 | A2 — voltar para A custa penalidade
    const pts = [0, 1, 3, 2];
    const d = pts.map((a) => pts.map((b) => Math.abs(a - b) * 60));
    const res = solveSequence({ durations: d, street: ['a', 'a', 'b', 'a'] });
    const st = res.order.map((i) => ['a', 'a', 'b', 'a'][i]).join('');
    expect(['aaab', 'baaa']).toContain(st);
  });
  it('performance com 80 paradas', () => {
    const n = 80;
    const pts = Array.from({ length: n }, (_, i) => ({ x: (i * 37) % 17, y: (i * 11) % 13 }));
    const d = pts.map((a) => pts.map((b) => Math.hypot(a.x - b.x, a.y - b.y) * 40 + (a.x > b.x ? 20 : 0)));
    const t0 = Date.now();
    solveSequence({ durations: d, street: pts.map((p) => `r${p.y}`) });
    expect(Date.now() - t0).toBeLessThan(8000);
  });
});

describe('grupos', () => {
  it('corta no salto grande e equilibra', () => {
    const g = splitIntoGroups({
      packages: [2, 2, 2, 2, 2, 2],
      edgeSeconds: [30, 30, 500, 30, 30],
      sameStreet: [true, true, false, true, true],
      crossing: [false, false, true, false, false],
      k: 2,
    });
    expect(g).toEqual([[0, 1, 2], [3, 4, 5]]);
  });
});

describe('auditoria', () => {
  const mk = (id: string, street: string, status: 'pending' | 'delivered' = 'pending', side?: number): Stop => ({
    id, original: { street, number: '1', raw: street }, complement: '', notes: '', propertyType: 'desconhecido',
    propertyTypeSource: 'nenhum', flags: [], dividerSide: side,
    packages: [{ id: id + 'p', label: '#' + id, number: 1, extra: false, status }],
  });
  it('alerta pendência na mesma rua, inclusive de outro grupo', () => {
    const a = mk('1', 'Rua Tomé de Souza', 'delivered');
    const b = mk('2', 'Rua Tomé de Souza');
    const c = mk('3', 'Rua Marília de Dirceu');
    const al = auditLeaving(a, c, [a, b, c]);
    expect(al[0].kind).toBe('mesma-rua');
    expect(al[0].stopIds).toEqual(['2']);
  });
  it('alerta antes de atravessar a avenida', () => {
    const a = mk('1', 'Rua A', 'delivered', 1);
    const b = mk('2', 'Rua B', 'pending', 1);
    const c = mk('3', 'Rua C', 'pending', -1);
    const al = auditLeaving(a, c, [a, b, c], 'Av. Fernando de Noronha');
    expect(al.some((x) => x.kind === 'antes-de-atravessar')).toBe(true);
  });
  it('não marca nada como entregue', () => {
    const a = mk('1', 'Rua A');
    const before = JSON.stringify(a);
    auditLeaving(a, undefined, [a]);
    expect(JSON.stringify(a)).toBe(before);
  });
});
