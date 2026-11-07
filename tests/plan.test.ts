import { expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
// Dados reais de clientes NÃO ficam no repositório: informe o caminho do arquivo de teste.
const FIX = process.env.ROUTE_LINES ?? '/home/claude/fixtures/rota-05-11.json';
const sample = existsSync(FIX) ? JSON.parse(readFileSync(FIX, 'utf8')) : null;
import { parseRouteLines } from '../src/importers/pdfRoute';
import { optimizedPlan } from '../src/optimize/plan';
import { straightLine } from '../src/services/routing/haversine';

it.skipIf(!sample)('plano otimizado cobre todas as paradas e pacotes, em 8 grupos', async () => {
  const r = parseRouteLines(sample.lines);
  // coordenadas sintéticas (não reais) só para exercitar o algoritmo
  r.stops.forEach((s, i) => { s.geo = { lat: -19.47 + (i % 9) * 0.001, lng: -42.54 + Math.floor(i / 9) * 0.001, precision: 'numero', verified: false, source: 'teste' }; });
  const located = r.stops.slice(0, 74);
  const m = await straightLine.matrix(located.map((s) => s.geo!));
  const plan = optimizedPlan(r.stops, located, m, { groupCount: 8, importedOrder: r.stops.map((s) => s.id) });
  expect(plan.method).toBe('linha-reta');
  expect(new Set(plan.order).size).toBe(76);
  expect(plan.groups.length).toBe(8);
  expect(plan.groups.flatMap((g) => g.stopIds).length).toBe(76);
  expect(plan.order.slice(-2)).toEqual(r.stops.slice(74).map((s) => s.id)); // sem localização vão para o fim
  expect(plan.notes.join(' ')).toContain('APROXIMADA');
});
