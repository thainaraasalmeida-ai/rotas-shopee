/// <reference lib="webworker" />
import { optimizedPlan, type PlanOptions } from './plan';
import type { Stop } from '../domain/types';
import type { TravelMatrix } from '../services/routing/types';

self.onmessage = (e: MessageEvent<{ stops: Stop[]; located: Stop[]; matrix: TravelMatrix; opts: PlanOptions }>) => {
  try {
    const { stops, located, matrix, opts } = e.data;
    (self as unknown as Worker).postMessage({ ok: true, plan: optimizedPlan(stops, located, matrix, opts) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: String(err) });
  }
};
