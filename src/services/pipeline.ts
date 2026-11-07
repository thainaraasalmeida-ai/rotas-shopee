import { addressKey, effectiveAddress, normalizeStreet } from '../domain/address';
import type { GeoPoint, RoutePlan, Stop } from '../domain/types';
import { optimizedPlan, type PlanOptions } from '../optimize/plan';
import { orderedStops, useStore } from '../store/store';
import { fetchDivider, sideOf } from './divider';
import { nominatim } from './geocoding/nominatim';
import type { GeocodingProvider } from './geocoding/types';
import { osrmProvider } from './routing/osrm';
import { straightLine } from './routing/haversine';
import type { LatLng, TravelMatrix } from './routing/types';

export interface Progress {
  step: string;
  done: number;
  total: number;
}

/** Localiza todas as paradas sem coordenada (usa conferidas > cache > geocodificador). */
export async function geocodeAll(onProgress: (p: Progress) => void, signal?: AbortSignal, provider: GeocodingProvider = nominatim) {
  const st = useStore.getState();
  const s = st.session;
  if (!s) return { ok: 0, failed: 0 };
  const stops = Object.values(s.stops).filter((x) => !x.geo);
  let ok = 0, failed = 0, i = 0;
  for (const stop of stops) {
    if (signal?.aborted) break;
    onProgress({ step: 'Localizando endereços', done: i, total: stops.length });
    const key = addressKey(effectiveAddress(stop));
    const verified = useStore.getState().verifiedGeo[key];
    let geo: GeoPoint | null | undefined = verified ?? useStore.getState().geoCache[key];
    if (geo === undefined) {
      try {
        geo = await provider.geocode(effectiveAddress(stop), signal);
        useStore.getState().cacheGeo(key, geo);
      } catch (e) {
        if (signal?.aborted) break;
        throw new Error(`Falha ao consultar o geocodificador (${(e as Error).message}). Verifique a internet.`);
      }
    }
    if (geo) { useStore.getState().setGeo(stop.id, geo); ok++; } else failed++;
    i++;
  }
  onProgress({ step: 'Localizando endereços', done: stops.length, total: stops.length });
  return { ok, failed };
}

/** Calcula o lado da avenida divisora para cada parada localizada. */
export async function computeDividerSides(signal?: AbortSignal): Promise<string> {
  const { session, settings, updateStop } = useStore.getState();
  if (!session || !settings.dividerEnabled || !settings.dividerName.trim()) return 'Avenida divisora desativada.';
  const located = Object.values(session.stops).filter((s) => s.geo);
  if (!located.length) return 'Sem paradas localizadas.';
  const lats = located.map((s) => s.geo!.lat), lngs = located.map((s) => s.geo!.lng);
  const div = await fetchDivider(settings.dividerName, { s: Math.min(...lats), n: Math.max(...lats), w: Math.min(...lngs), e: Math.max(...lngs) }, signal);
  if (!div) return `Não encontrei "${settings.dividerName}" no mapa desta região.`;
  for (const s of located) {
    const onAvenue = normalizeStreet(effectiveAddress(s).street) === normalizeStreet(settings.dividerName);
    updateStop(s.id, { dividerSide: onAvenue ? undefined : sideOf(s.geo!, div) || undefined });
  }
  dividerCache = div;
  return `Avenida divisora: ${settings.dividerName} (${div.lines.length} trecho(s) no mapa).`;
}
export let dividerCache: Awaited<ReturnType<typeof fetchDivider>> = null;

function runInWorker(stops: Stop[], located: Stop[], matrix: TravelMatrix, opts: PlanOptions): Promise<RoutePlan> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('../optimize/worker.ts', import.meta.url), { type: 'module' });
    } catch {
      // Sem suporte a worker: roda na thread principal
      resolve(optimizedPlan(stops, located, matrix, opts));
      return;
    }
    worker.onmessage = (e) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.plan);
      else reject(new Error(e.data.error));
    };
    worker.onerror = () => {
      worker.terminate();
      try { resolve(optimizedPlan(stops, located, matrix, opts)); } catch (err) { reject(err); }
    };
    worker.postMessage({ stops, located, matrix, opts });
  });
}

/** Matriz de tempos pela malha viária e otimização global. */
export async function optimizeRoute(onProgress: (p: Progress) => void, signal?: AbortSignal, start?: LatLng): Promise<{ plan: RoutePlan; warning?: string }> {
  const { session, settings, setPlan } = useStore.getState();
  if (!session) throw new Error('Nenhuma rota importada.');
  const stops = orderedStops(session);
  const located = stops.filter((s) => s.geo);
  if (located.length < 2) throw new Error('Localize os endereços antes de otimizar (mínimo 2 paradas com localização).');
  const points: LatLng[] = located.map((s) => ({ lat: s.geo!.lat, lng: s.geo!.lng }));
  if (start) points.push(start);

  onProgress({ step: 'Consultando tempos de carro pela malha viária', done: 0, total: 1 });
  let matrix: TravelMatrix;
  let warning: string | undefined;
  try {
    matrix = await osrmProvider(settings.osrmUrl).matrix(points, signal);
  } catch (e) {
    warning = `Serviço de rotas indisponível (${(e as Error).message}). Usei estimativa em linha reta — a ordem é APROXIMADA.`;
    matrix = await straightLine.matrix(points);
  }
  let fromStart: number[] | undefined;
  if (start) {
    const si = points.length - 1;
    fromStart = matrix.durations[si].slice(0, si);
    matrix = { ...matrix, durations: matrix.durations.slice(0, si).map((r) => r.slice(0, si)) };
  }
  onProgress({ step: 'Otimizando a sequência de todas as paradas', done: 0, total: 1 });
  const plan = await runInWorker(stops, located, matrix, { groupCount: settings.groupCount, importedOrder: session.importedOrder, fromStart, exclude: Object.keys(session.specials ?? {}) });
  setPlan(plan);
  onProgress({ step: 'Concluído', done: 1, total: 1 });
  return { plan, warning };
}
