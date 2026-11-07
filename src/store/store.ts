import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { addressKey, effectiveAddress } from '../domain/address';
import type { Address, AuditEntry, GeoPoint, ImportIssue, ImportResult, PackageStatus, PropertyType, RoutePlan, Stop } from '../domain/types';
import { importedPlan } from '../optimize/plan';
import { safeStorage } from './persistence';

export interface Session {
  id: string;
  createdAt: number;
  source: ImportResult['source'];
  fileName: string;
  title?: string;
  issues: ImportIssue[];
  declared?: ImportResult['declared'];
  stops: Record<string, Stop>;
  importedOrder: string[];
  importedGroupNames: Record<number, string>;
  plan: RoutePlan;
  cursor?: string;
  skipped: string[];
  audit: AuditEntry[];
}

export interface Settings {
  groupCount: number;
  dividerName: string;
  dividerEnabled: boolean;
  osrmUrl: string;
  useGpsStart: boolean;
}

interface State {
  session: Session | null;
  settings: Settings;
  /** Coordenadas conferidas pelo entregador, reaproveitadas nas próximas rotas (por endereço). */
  verifiedGeo: Record<string, GeoPoint>;
  /** Cache do geocodificador (por endereço). */
  geoCache: Record<string, GeoPoint | null>;

  loadImport(r: ImportResult): void;
  clearSession(): void;
  setPlan(plan: RoutePlan): void;
  updateStop(id: string, patch: Partial<Stop>): void;
  setPackagesStatus(stopId: string, status: PackageStatus, opts?: { packageIds?: string[]; reason?: string }): void;
  correctAddress(stopId: string, a: Address | undefined, note?: string): void;
  confirmPropertyType(stopId: string, t: PropertyType): void;
  setGeo(stopId: string, geo: GeoPoint | undefined): void;
  setCursor(stopId: string | undefined): void;
  markSkipped(stopId: string, skipped: boolean): void;
  addAudit(e: AuditEntry): void;
  setSettings(p: Partial<Settings>): void;
  cacheGeo(key: string, g: GeoPoint | null): void;
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      session: null,
      settings: { groupCount: 8, dividerName: 'Avenida Fernando de Noronha', dividerEnabled: true, osrmUrl: 'https://router.project-osrm.org', useGpsStart: false },
      verifiedGeo: {},
      geoCache: {},

      loadImport(r) {
        const verified = get().verifiedGeo;
        const stops: Record<string, Stop> = {};
        for (const s of r.stops) {
          const v = verified[addressKey(s.original)];
          stops[s.id] = v ? { ...s, geo: v } : s;
        }
        const groupCount = r.groups.length || get().settings.groupCount;
        const session: Session = {
          id: `sess-${Date.now()}`,
          createdAt: Date.now(),
          source: r.source,
          fileName: r.fileName,
          title: r.title,
          issues: r.issues,
          declared: r.declared,
          stops,
          importedOrder: r.stops.map((s) => s.id),
          importedGroupNames: Object.fromEntries(r.groups.filter((g) => g.name).map((g) => [g.index, g.name!])),
          plan: importedPlan(r.stops, r.groups, groupCount),
          skipped: [],
          audit: [],
        };
        set({ session, settings: { ...get().settings, groupCount } });
      },
      clearSession() {
        set({ session: null });
      },
      setPlan(plan) {
        const s = get().session;
        if (!s) return;
        set({ session: { ...s, plan, cursor: undefined, skipped: [] } });
      },
      updateStop(id, patch) {
        const s = get().session;
        if (!s) return;
        set({ session: { ...s, stops: { ...s.stops, [id]: { ...s.stops[id], ...patch } } } });
      },
      setPackagesStatus(stopId, status, opts) {
        const s = get().session;
        if (!s) return;
        const st = s.stops[stopId];
        const packages = st.packages.map((p) =>
          !opts?.packageIds || opts.packageIds.includes(p.id)
            ? { ...p, status, failReason: status === 'failed' ? opts?.reason : undefined, updatedAt: Date.now() }
            : p,
        );
        get().updateStop(stopId, { packages });
      },
      correctAddress(stopId, a, note) {
        const s = get().session;
        if (!s) return;
        // O original da Shopee é preservado; só a correção muda. A localização é refeita.
        const st = s.stops[stopId];
        const v = a ? get().verifiedGeo[addressKey(a)] : get().verifiedGeo[addressKey(st.original)];
        get().updateStop(stopId, { corrected: a, correctionNote: note, geo: v, dividerSide: undefined });
        const s2 = get().session!;
        set({
          session: {
            ...s2,
            plan: { ...s2.plan, stale: true },
            audit: [...s2.audit, { at: Date.now(), kind: 'correcao', stopId, justification: note || (a ? `Corrigido para ${a.street}, ${a.number}` : 'Correção removida'), pendingStopIds: [] }],
          },
        });
      },
      confirmPropertyType(stopId, t) {
        get().updateStop(stopId, { propertyType: t, propertyTypeSource: 'confirmado' });
      },
      setGeo(stopId, geo) {
        const s = get().session;
        if (!s) return;
        get().updateStop(stopId, { geo });
        if (geo?.verified) {
          const key = addressKey(effectiveAddress(s.stops[stopId]));
          set({ verifiedGeo: { ...get().verifiedGeo, [key]: geo } });
        }
      },
      setCursor(stopId) {
        const s = get().session;
        if (!s) return;
        set({ session: { ...s, cursor: stopId } });
      },
      markSkipped(stopId, skipped) {
        const s = get().session;
        if (!s) return;
        const list = s.skipped.filter((x) => x !== stopId);
        set({ session: { ...s, skipped: skipped ? [...list, stopId] : list } });
      },
      addAudit(e) {
        const s = get().session;
        if (!s) return;
        set({ session: { ...s, audit: [...s.audit, e] } });
      },
      setSettings(p) {
        set({ settings: { ...get().settings, ...p } });
      },
      cacheGeo(key, g) {
        set({ geoCache: { ...get().geoCache, [key]: g } });
      },
    }),
    { name: 'rotas-shopee-v1', storage: createJSONStorage(() => safeStorage), version: 1 },
  ),
);

// Seletores
export function orderedStops(s: Session): Stop[] {
  return s.plan.order.map((id) => s.stops[id]).filter(Boolean);
}

export function groupOfStop(s: Session, stopId: string) {
  return s.plan.groups.find((g) => g.stopIds.includes(stopId));
}

export const isPending = (st: Stop) => st.packages.some((p) => p.status === 'pending');

/** Próxima parada: segue a ordem; paradas puladas voltam no fim. */
export function nextStopId(s: Session, afterId?: string): string | undefined {
  const order = s.plan.order;
  const start = afterId ? order.indexOf(afterId) + 1 : 0;
  const candidates = [...order.slice(start), ...order.slice(0, start)];
  const notSkipped = candidates.find((id) => id !== afterId && isPending(s.stops[id]) && !s.skipped.includes(id));
  if (notSkipped) return notSkipped;
  return candidates.find((id) => id !== afterId && isPending(s.stops[id])) ?? (afterId && isPending(s.stops[afterId]) ? afterId : undefined);
}

export function currentStopId(s: Session): string | undefined {
  if (s.cursor && s.stops[s.cursor] && isPending(s.stops[s.cursor])) return s.cursor;
  return nextStopId(s, undefined);
}
