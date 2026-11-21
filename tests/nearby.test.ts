import { describe, expect, it } from 'vitest';
import { findNearby, sameStretch } from '../src/services/nearby';
import type { MatrixProvider } from '../src/services/routing/types';
import type { Session } from '../src/store/store';

// Cenário fictício: avenida com canteiro central. "Do outro lado" fica a 40 m em linha reta,
// mas pelas ruas exige ir até o retorno (1,8 km). Na mesma quadra, em outra sacola, há duas entregas na mesma rua.
const stop = (id: string, street: string, number: string, lat: number, lng: number, labels: string[]) => ({
  id, original: { street, number, district: 'Centro', city: 'Ipatinga', state: 'MG', raw: '' }, complement: '', notes: '', flags: [],
  geo: { lat, lng, precision: 'shopee', verified: false, source: 'teste' },
  packages: labels.map(l => ({ id: id + l, label: l, number: +l.slice(1), extra: false, status: 'pending' })),
});
const here = { lat: -19.5, lng: -42.5 };
const stops = [
  stop('planejada', 'Rua Planejada', '10', -19.503, -42.5, ['#1']),
  stop('outroLado', 'Avenida Central', '900', -19.50036, -42.5, ['#2']), // 40 m em linha reta
  stop('quadraA', 'Rua das Flores', '20', -19.5, -42.5007, ['#3', '#4']), // ~73 m
  stop('quadraB', 'Rua das Flores', '60', -19.5, -42.5012, ['#5']),
  stop('longe', 'Rua Distante', '1', -19.52, -42.52, ['#6']),
];
const session = {
  stops: Object.fromEntries(stops.map(s => [s.id, s])),
  plan: { order: stops.map(s => s.id), groups: [{ index: 1, colorKey: 'azul', stopIds: ['planejada', 'outroLado', 'longe'] }, { index: 4, colorKey: 'roxo', stopIds: ['quadraA', 'quadraB'] }] },
  skipped: [], audit: [], carLoad: [{ index: 1, colorKey: 'azul', stopIds: ['planejada', 'outroLado', 'longe'] }, { index: 4, colorKey: 'roxo', stopIds: ['quadraA', 'quadraB'] }],
} as unknown as Session;

// Matriz de carro (segundos / metros): índice 0 = aqui, 1 = planejada, depois os candidatos na ordem do pré-filtro.
const sec: Record<string, number> = { planejada: 70, outroLado: 260, quadraA: 35, quadraB: 50, longe: 600 };
const met: Record<string, number> = { planejada: 340, outroLado: 1800, quadraA: 90, quadraB: 140, longe: 3500 };
const toPlanned: Record<string, number> = { outroLado: 240, quadraA: 60, quadraB: 75, longe: 620 };
const fake: MatrixProvider = {
  name: 'teste',
  async matrix(points) {
    const id = (p: { lat: number; lng: number }) => p === points[0] ? 'aqui' : stops.find(s => s.geo.lat === p.lat && s.geo.lng === p.lng)!.id;
    const ids = points.map(id);
    const durations = ids.map(a => ids.map(b => a === b ? 0 : a === 'aqui' ? sec[b] : b === 'planejada' ? toPlanned[a] : 300));
    const distances = ids.map(a => ids.map(b => a === 'aqui' && b !== 'aqui' ? met[b] : 0));
    return { durations, distances, method: 'malha-viaria', provider: 'teste' };
  },
};

describe('Perto de mim', () => {
  it('ordena pelo tempo pelas ruas, não pela linha reta, e calcula o desvio até a parada planejada', async () => {
    const r = await findNearby(session, here, 12, fake);
    expect(r.planned).toEqual({ stopId: 'planejada', seconds: 70 });
    expect(r.options.map(o => o.stopId)).toEqual(['quadraA', 'quadraB', 'outroLado', 'longe']);
    const a = r.options[0];
    expect(a.detourSeconds).toBe(35 + 60 - 70);
    expect(a.sameStreet).toEqual(['quadraB']);
    const lado = r.options.find(o => o.stopId === 'outroLado')!;
    expect(lado.straightMeters).toBeLessThan(a.straightMeters); // parece mais perto no mapa…
    expect(lado.roundabout).toBe(true); // …mas exige retorno pela avenida
    expect(lado.detourSeconds).toBe(260 + 240 - 70);
  });
  it('não mexe na rota salva', async () => {
    const before = JSON.stringify(session);
    await findNearby(session, here, 12, fake);
    expect(JSON.stringify(session)).toBe(before);
  });
  it('destaca entregas no mesmo trecho em qualquer sacola', () => {
    expect(sameStretch(session, 'quadraB')).toEqual(['quadraA']);
    expect(sameStretch(session, 'longe')).toEqual([]);
  });
});
