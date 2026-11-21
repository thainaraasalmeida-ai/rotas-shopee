import { describe, expect, it } from 'vitest';
import { lookupCode } from '../src/ui/components/ScanSort';
import { forecast } from '../src/ui/components/GoalLine';
import type { Session } from '../src/store/store';

const pk = (id: string, label: string, number: number | null, tracking: string, status = 'pending') => ({ id, label, number, extra: number === null, tracking, status });
const mk = () => ({
  stops: {
    a: { id: 'a', original: { street: 'Rua Um', number: '144' }, packages: [pk('a1', '#115', 115, 'BR0001'), pk('a2', '#116', 116, 'BR0002'), pk('a3', '+1', null, 'BR0003')] },
    b: { id: 'b', original: { street: 'Rua Dois', number: '10' }, packages: [pk('b1', '#7', 7, 'BR0007')] },
  },
  plan: { order: ['b', 'a'], groups: [{ index: 1, colorKey: 'azul', stopIds: ['b'] }, { index: 3, colorKey: 'verde', stopIds: ['a'] }], legSeconds: { b: 300, a: 120 }, totalSeconds: 420 },
  skipped: [], audit: [],
}) as unknown as Session;

describe('Leitura de etiquetas', () => {
  it('identifica pelo código completo, inclusive extra sem número', () => {
    const r = lookupCode(mk(), ' br0003 ');
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') { expect(r.pkg.id).toBe('a3'); expect(r.bag).toBe(3); expect(r.position).toBe(2); }
  });
  it('leitura repetida mostra a sacola registrada e não conta de novo', () => {
    const s = { ...mk(), sorted: { a1: { bag: 3, colorKey: 'verde', at: 1 } } } as Session;
    const r = lookupCode(s, 'BR0001');
    expect(r.kind).toBe('repeat');
    if (r.kind === 'repeat') expect(r.bag).toBe(3);
  });
  it('código de outra rota gera aviso', () => {
    expect(lookupCode(mk(), 'BR9999').kind).toBe('foreign');
  });
});

describe('Meta de 4 horas', () => {
  it('saída às 11h20 → meta 15h20; previsão soma carro restante e paradas sem duplicar o deslocamento', () => {
    const dep = new Date(2026, 10, 20, 11, 20).getTime();
    const s = { ...mk(), shift: { departedAt: dep } } as Session;
    const f = forecast(s, dep)!;
    expect(new Date(f.target).getHours()).toBe(15);
    expect(new Date(f.target).getMinutes()).toBe(20);
    expect(f.remainingDrive).toBe(420);
    expect(f.end).toBe(dep + (420 + 2 * 150) * 1000);
    expect(f.late).toBe(false);
  });
  it('avisa quando o ritmo observado leva além das 4 horas', () => {
    const dep = 1_700_000_000_000;
    const stops: Record<string, unknown> = {}; const order: string[] = []; const legs: Record<string, number> = {};
    for (let i = 0; i < 100; i++) { const id = 's' + i; order.push(id); legs[id] = 60; stops[id] = { id, original: { street: 'R', number: String(i) }, packages: [pk(id + 'p', '#' + i, i, 'T' + i, i < 10 ? 'delivered' : 'pending')] }; }
    const s = { stops, plan: { order, groups: [], legSeconds: legs }, skipped: [], audit: [], shift: { departedAt: dep } } as unknown as Session;
    const f = forecast(s, dep + 40 * 60000)!; // 10 paradas em 40 min: 10 min de carro, 3 min por parada
    expect(Math.round(f.service)).toBe(180);
    expect(f.remainingDrive).toBe(90 * 60);
    expect(f.late).toBe(true);
  });
});
describe('Busca pelo final do rastreio', () => {
  it('acha o extra sem número pelos últimos caracteres', () => {
    const r = lookupCode(mk(), '0003');
    expect(r.kind).toBe('ok');
  });
});
describe('Número +N da etiqueta da gaiola', () => {
  it('pede para escolher entre os extras e depois reconhece pelo apelido', () => {
    const s = mk();
    const r = lookupCode(s, '+3');
    expect(r.kind).toBe('choose');
    const s2 = { ...s, stickerAlias: { '+3': 'a3' } } as Session;
    const r2 = lookupCode(s2, '+3');
    expect(r2.kind).toBe('ok');
    if (r2.kind === 'ok') expect(r2.pkg.id).toBe('a3');
  });
});
