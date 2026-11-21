import { describe, expect, it } from 'vitest';
import { makeCost, solveSequence, travelTime } from '../src/optimize/sequence';
import { splitIntoGroups } from '../src/optimize/groups';
import { auditLeaving } from '../src/audit/audit';
import type { Stop } from '../src/domain/types';

function grid(n: number) {
  // pontos em linha com uma "mão única": ir de i para i-1 custa muito mais
  const d = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (j >= i ? (j - i) * 30 : (i - j) * 30 + 400)));
  return d;
}

describe('sequenciamento', () => {
  it('conta a mudança de lado mesmo com uma parada sobre a avenida', () => {
    const durations = Array.from({ length: 5 }, () => Array(5).fill(0));
    const cost = makeCost({ durations, street: Array(5).fill('a'), side: [1, undefined, -1, undefined, 1], crossingPenalty: 90 });
    expect(cost([0, 1, 2, 3, 4])).toBe(180);
    expect(cost([0, 4, 1, 3, 2])).toBe(90);
  });
  it('prefere terminar um lado quando tempos de carro são equivalentes', () => {
    const durations = Array.from({ length: 6 }, (_, start) => Array.from({ length: 6 }, (_, end) => start === end ? 0 : 45));
    const side = [1, -1, 1, -1, 1, -1];
    const { order } = solveSequence({ durations, side, street: Array(6).fill('rua'), fromStart: [0, 600, 600, 600, 600, 600] });
    expect(order.map(index => side[index])).toEqual([1, 1, 1, -1, -1, -1]);
  });
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
  it('confere o trecho onde o motorista está mesmo que a rua continue do outro lado', () => {
    const current = mk('1', 'Rua A', 'delivered', 1);
    const sameBlock = mk('2', 'Rua A', 'pending', 1);
    const next = mk('3', 'Rua A', 'pending', -1);
    const farBlock = mk('4', 'Rua A', 'pending', -1);
    const alerts = auditLeaving(current, next, [current, sameBlock, next, farBlock]);
    expect(alerts.flatMap(alert => alert.stopIds)).toEqual([sameBlock.id]);
  });
  it('não marca nada como entregue', () => {
    const a = mk('1', 'Rua A');
    const before = JSON.stringify(a);
    auditLeaving(a, undefined, [a]);
    expect(JSON.stringify(a)).toBe(before);
  });
});
