import { expect, it } from 'vitest';
import { auditLeaving } from '../src/audit/audit';
import { parseRouteLines } from '../src/importers/pdfRoute';
import { parseSheetRows } from '../src/importers/spreadsheet';
import { matchTracking } from '../src/ui/components/LabelCheck';
import { currentStopId, useStore } from '../src/store/store';
import {combineTracking} from '../src/importers/combine';
import {addressKey} from '../src/domain/address';
import {optimizeRoute} from '../src/services/pipeline';
import {vi} from 'vitest';

const header = ['Sequence', 'SPX TN', 'Destination Address', 'City'];
function route() {
  return parseSheetRows([header, ['114','BR0114','Rua A, 10','Ipatinga'], ['119','BR0119','Rua B, 20','Ipatinga'], ['31','BR0031','Rua B, 20A','Ipatinga']], 'exemplo');
}
it('distingue a etiqueta física da baixa e mantém o volume pendente', () => {
  const result = route();
  useStore.getState().loadImport(result);
  const match = matchTracking(result.stops, ' br0114 ')[0];
  expect(match.pkg.label).toBe('#114');
  expect(matchTracking(result.stops, '114')).toEqual([]);
  useStore.getState().updateStop(match.stop.id, { packages: [{ ...match.pkg, shopeeClosed: true }] });
  expect(useStore.getState().session!.stops[match.stop.id].packages[0].status).toBe('pending');
  useStore.getState().setCursor(match.stop.id);
  expect(currentStopId(useStore.getState().session!)).toBe(match.stop.id);
  useStore.getState().setPackagesStatus(match.stop.id, 'delivered');
  expect(useStore.getState().session!.stops[match.stop.id].packages[0].shopeeClosed).toBe(true);
});
it('audita a mesma rua em grupos diferentes, sem misturar números com sufixo', () => {
  const stops = route().stops;
  expect(stops.length).toBe(3);
  const [first, next, other] = ['#119','#114','#31'].map(label => stops.find(stop => stop.packages[0].label === label)!);
  first.importedGroup = 4;
  other.importedGroup = 8;
  expect(auditLeaving(first,next,stops)[0].stopIds).toContain(other.id);
});
it('confere extras com a quantidade declarada em cada parada', () => {
  const parsed = parseRouteLines(['4 pacotes · 2 paradas','GRUPO 1 Azul 4 pacotes · 2 paradas','1 Rua A, 12 #28 #29 +1 3','2 Rua B, 15 +4 1']);
  expect(parsed.stops.map(stop => stop.packages.length)).toEqual([3,1]);
  expect(parsed.issues.filter(issue => issue.level === 'erro')).toEqual([]);
});
it('sinaliza linha sem endereço e diferença de contagem por parada', () => {
  expect(parseSheetRows([header,['10','BR10','','Ipatinga']],'teste').issues.some(issue => issue.level === 'erro')).toBe(true);
  expect(parseRouteLines(['1 Rua A, 10 #1 2']).issues.some(issue => issue.level === 'erro')).toBe(true);
});

it('preserva a rota no erro de rede, sem aceitar linha reta', async () => {
  const r = route();
  r.stops.forEach((s,i) => s.geo = {lat:-19.5,lng:-42.51-i*.01,precision:'shopee',source:'teste',verified:false});
  useStore.getState().loadImport(r);
  const plan = useStore.getState().session!.plan;
  const fail = vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('offline'));
  try {
    await expect(optimizeRoute(() => {})).rejects.toThrow('ordem atual foi mantida');
    expect(useStore.getState().session!.plan).toBe(plan);
  } finally {fail.mockRestore();}
});
it('vincula rastreios com endereço e contagem iguais, preserva estado e recusa ambiguidade', () => {
  const sheet = route().stops;
  const pdf = sheet.map(st => ({...st,packages:st.packages.map(p => ({...p,tracking:undefined,shopeeClosed:true}))}));
  const merged = combineTracking(pdf,sheet);
  expect(merged[0].packages[0].shopeeClosed).toBe(true);
  expect(merged.flatMap(st => st.packages.map(p => p.tracking))).toEqual(sheet.flatMap(st => st.packages.map(p => p.tracking)));
  expect(() => combineTracking(pdf,sheet.slice(1))).toThrow();
});
it('mantém data combinada e histórico independente da baixa na Shopee', () => {
  const r = route();
  const st = r.stops[0];
  const pkg = st.packages[0];
  const store = useStore.getState();
  store.loadImport(r);store.setClosed(st.id,pkg.id,true);store.setPackagesStatus(st.id,'rescheduled',{date:'2026-11-21',packageIds:[pkg.id]});
  expect(useStore.getState().session!.stops[st.id].packages[0]).toMatchObject({status:'rescheduled',rescheduledFor:'2026-11-21',shopeeClosed:true});
  store.setPackagesStatus(st.id,'pending',{packageIds:[pkg.id]});
  expect(useStore.getState().session!.audit.filter(e => e.packageId===pkg.id)).toHaveLength(3);
});
it('mantém o endereço com sufixo e bairro na chave e permite fixar a última parada', () => {
  const r = route();
  const a = r.stops[0].original;
  expect(addressKey({...a,number:'20A',district:'Horto'})).not.toBe(addressKey({...a,number:'20',district:'Horto'}));
  expect(addressKey({...a,district:'Cariru'})).not.toBe(addressKey({...a,district:'Horto'}));
  useStore.getState().loadImport(r);
  const first = r.stops[0].id;
  useStore.getState().pinLast(first,true);
  expect(useStore.getState().session!.plan.order.at(-1)).toBe(first);
  expect(currentStopId(useStore.getState().session!)).not.toBe(first);
});
