import { normalizeStreet, effectiveAddress } from '../domain/address';
import type { Stop } from '../domain/types';
import type { Session } from '../store/store';
import { isPending, plannedStopId } from '../store/store';
import { haversineMeters } from './routing/haversine';
import type { LatLng, MatrixProvider } from './routing/types';

export interface NearbyOption {
  stopId: string;
  /** segundos de carro daqui até a entrega, pelas ruas */
  seconds: number;
  roadMeters: number;
  /** distância em linha reta (o que o mapa "parece" mostrar) */
  straightMeters: number;
  /** daqui → entrega → próxima planejada, menos daqui → próxima planejada */
  detourSeconds?: number;
  viaSeconds?: number;
  /** outras entregas pendentes na mesma rua, perto desta (qualquer sacola) */
  sameStreet: string[];
  /** a rua obriga a dar a volta: tempo pelas ruas bem maior do que a linha reta sugere */
  roundabout: boolean;
}

export interface NearbyResult {
  here: LatLng;
  accuracy: number;
  planned?: { stopId: string; seconds: number };
  options: NearbyOption[];
  provider: string;
}

export const MAX_ACCURACY_M = 80;
const PREFILTER = 24;
const SAME_STRETCH_M = 300;

const streetOf = (st: Stop) => normalizeStreet(effectiveAddress(st).street);
const pos = (st: Stop): LatLng => ({ lat: st.geo!.lat, lng: st.geo!.lng });

/** Outras entregas pendentes na mesma rua e no mesmo trecho (até 300 m), em qualquer sacola. */
export function sameStretch(s: Session, stopId: string): string[] {
  const st = s.stops[stopId];
  if (!st?.geo) return [];
  const key = streetOf(st);
  return Object.values(s.stops)
    .filter(o => o.id !== stopId && isPending(o) && o.geo && streetOf(o) === key && haversineMeters(pos(o), pos(st)) <= SAME_STRETCH_M)
    .map(o => o.id);
}

/**
 * Procura entregas pendentes de todas as sacolas a partir da posição atual.
 * Ordena pelo tempo de carro pelas ruas (mão única, conversões e travessias vêm do motor de rotas).
 * Não altera a rota salva.
 */
export async function findNearby(s: Session, here: LatLng, accuracy: number, provider: MatrixProvider, signal?: AbortSignal, limit = 5): Promise<NearbyResult> {
  const plannedId = plannedStopId(s);
  const planned = plannedId && s.stops[plannedId]?.geo ? s.stops[plannedId] : undefined;
  const pool = Object.values(s.stops)
    .filter(st => isPending(st) && st.geo && st.id !== planned?.id && st.id !== s.detour?.stopId)
    .map(st => ({ st, m: haversineMeters(here, pos(st)) }))
    .sort((a, b) => a.m - b.m)
    .slice(0, PREFILTER);
  if (!pool.length && !planned) return { here, accuracy, options: [], provider: provider.name };
  const points: LatLng[] = [here, ...(planned ? [pos(planned)] : []), ...pool.map(p => pos(p.st))];
  const m = await provider.matrix(points, signal);
  const off = planned ? 2 : 1;
  const direct = planned ? m.durations[0][1] : undefined;
  const options: NearbyOption[] = pool.map((p, k) => {
    const i = k + off;
    const seconds = m.durations[0][i];
    const roadMeters = m.distances?.[0][i] ?? 0;
    const via = planned ? seconds + m.durations[i][1] : undefined;
    return {
      stopId: p.st.id, seconds, roadMeters, straightMeters: p.m,
      viaSeconds: via, detourSeconds: via !== undefined && direct !== undefined ? Math.max(0, via - direct) : undefined,
      sameStreet: sameStretch(s, p.st.id),
      roundabout: roadMeters > 2.5 * p.m + 250,
    };
  }).sort((a, b) => a.seconds - b.seconds || a.straightMeters - b.straightMeters);
  return { here, accuracy, provider: provider.name, planned: planned && direct !== undefined ? { stopId: planned.id, seconds: direct } : undefined, options: options.slice(0, limit) };
}

export function fmtDrive(sec: number): string {
  if (sec < 90) return `${Math.max(5, Math.round(sec / 5) * 5)} s`;
  const m = Math.floor(sec / 60), r = Math.round((sec % 60) / 10) * 10;
  return sec < 600 && r ? `${m} min ${r} s` : `${Math.round(sec / 60)} min`;
}
