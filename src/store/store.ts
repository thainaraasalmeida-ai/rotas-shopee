import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { addressKey, effectiveAddress } from '../domain/address';
import type { Address, AuditEntry, GeoPoint, ImportIssue, ImportResult, PackageStatus, PropertyType, RoutePlan, Stop } from '../domain/types';
import { importedPlan } from '../optimize/plan';
import { detectCollectionPoints, regroup, type SpecialKind } from '../optimize/special';
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
  /** Pontos de coleta desta rota (stopId → automático/manual). Sobrevivem a recálculos. */
  specials?: Record<string, SpecialKind>;
  /** Endereços que o usuário disse que NÃO são ponto de coleta nesta rota. */
  specialDeclined?: string[];
  /** Sugestões aprendidas que o usuário dispensou nesta rota. */
  suggestionsDismissed?: string[];
}

export interface Settings {
  groupCount: number;
  dividerName: string;
  dividerEnabled: boolean;
  osrmUrl: string;
  useGpsStart: boolean;
  /** A partir de quantos pacotes no mesmo endereço vira ponto de coleta. */
  collectionThreshold: number;
}

interface State {
  session: Session | null;
  settings: Settings;
  /** Coordenadas conferidas pelo entregador, reaproveitadas nas próximas rotas (por endereço). */
  verifiedGeo: Record<string, GeoPoint>;
  /** Cache do geocodificador (por endereço). */
  geoCache: Record<string, GeoPoint | null>;
  /** Pontos de coleta que o usuário marcou à mão em rotas anteriores (por endereço). */
  learnedCollectionPoints: Record<string, { label: string; at: number }>;

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
  setSpecial(stopId: string, on: boolean): void;
  applyAutoSpecials(): void;
  dismissSuggestion(stopId: string): void;
  toggleSeparated(stopId: string, packageId: string): void;
  setAllSeparated(stopId: string, value: boolean): void;
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      session: null,
      settings: { groupCount: 8, dividerName: 'Avenida Fernando de Noronha', dividerEnabled: true, osrmUrl: 'https://router.project-osrm.org', useGpsStart: false, collectionThreshold: 10 },
      verifiedGeo: {},
      geoCache: {},
      learnedCollectionPoints: {},

      loadImport(r) {
        const verified = get().verifiedGeo;
        const stops: Record<string, Stop> = {};
        for (const s of r.stops) {
          const v = verified[addressKey(s.original)];
          stops[s.id] = v ? { ...s, geo: v } : s;
        }
        const groupCount = r.groups.length || get().settings.groupCount;
        const specials: Record<string, SpecialKind> = {};
        for (const id of detectCollectionPoints(r.stops, get().settings.collectionThreshold)) specials[id] = 'auto';
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
          plan: importedPlan(r.stops, r.groups, groupCount, Object.keys(specials)),
          skipped: [],
          audit: [],
          specials,
          specialDeclined: [],
          suggestionsDismissed: [],
        };
        session.plan = { ...session.plan, groups: regroup(session.plan.order, session.plan.groups, specials) };
        set({ session, settings: { ...get().settings, groupCount } });
      },
      clearSession() {
        set({ session: null });
      },
      setPlan(plan) {
        const s = get().session;
        if (!s) return;
        // Grupos especiais são preservados em qualquer recálculo.
        const groups = regroup(plan.order, plan.groups, s.specials ?? {});
        set({ session: { ...s, plan: { ...plan, groups }, cursor: undefined, skipped: [] } });
      },
      setSpecial(stopId, on) {
        const s = get().session;
        if (!s) return;
        const specials = { ...(s.specials ?? {}) };
        let declined = s.specialDeclined ?? [];
        const learned = { ...get().learnedCollectionPoints };
        const key = addressKey(effectiveAddress(s.stops[stopId]));
        if (on) {
          specials[stopId] = 'manual';
          declined = declined.filter((x) => x !== stopId);
          const a = effectiveAddress(s.stops[stopId]);
          learned[key] = { label: `${a.street}, ${a.number}`, at: Date.now() }; // aprende para sugerir nas próximas rotas
        } else {
          delete specials[stopId];
          if (!declined.includes(stopId)) declined = [...declined, stopId];
          delete learned[key];
        }
        const groups = regroup(s.plan.order, s.plan.groups, specials);
        set({ learnedCollectionPoints: learned, session: { ...s, specials, specialDeclined: declined, plan: { ...s.plan, groups } } });
      },
      applyAutoSpecials() {
        const s = get().session;
        if (!s) return;
        const specials: Record<string, SpecialKind> = {};
        for (const [id, k] of Object.entries(s.specials ?? {})) if (k === 'manual') specials[id] = k;
        for (const id of detectCollectionPoints(Object.values(s.stops), get().settings.collectionThreshold, s.specialDeclined ?? [])) if (!specials[id]) specials[id] = 'auto';
        const groups = regroup(s.plan.order, s.plan.groups, specials);
        set({ session: { ...s, specials, specialDeclined: s.specialDeclined ?? [], suggestionsDismissed: s.suggestionsDismissed ?? [], plan: { ...s.plan, groups } } });
      },
      dismissSuggestion(stopId) {
        const s = get().session;
        if (!s) return;
        set({ session: { ...s, suggestionsDismissed: [...(s.suggestionsDismissed ?? []), stopId] } });
      },
      toggleSeparated(stopId, packageId) {
        const s = get().session;
        if (!s) return;
        const st = s.stops[stopId];
        get().updateStop(stopId, { packages: st.packages.map((p) => (p.id === packageId ? { ...p, separated: !p.separated } : p)) });
      },
      setAllSeparated(stopId, value) {
        const s = get().session;
        if (!s) return;
        get().updateStop(stopId, { packages: s.stops[stopId].packages.map((p) => ({ ...p, separated: value })) });
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
    {
      name: 'rotas-shopee-v1',
      storage: createJSONStorage(() => safeStorage),
      version: 2,
      // v1 → v2: mantém rota e progresso; os pontos de coleta são calculados ao abrir (applyAutoSpecials).
      migrate: (persisted, version) => {
        const st = (persisted ?? {}) as Partial<State>;
        if (version < 2) {
          st.settings = { ...(st.settings as Settings), collectionThreshold: 10 };
          st.learnedCollectionPoints = st.learnedCollectionPoints ?? {};
        }
        return st as State;
      },
    },
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

/** Sugestões aprendidas: endereços desta rota marcados como ponto de coleta em rotas anteriores (precisam de confirmação). */
export function collectionSuggestions(s: Session, learned: Record<string, { label: string; at: number }>): string[] {
  return Object.values(s.stops)
    .filter((st) => learned[addressKey(effectiveAddress(st))] && !(s.specials ?? {})[st.id] && !(s.suggestionsDismissed ?? []).includes(st.id))
    .map((st) => st.id);
}
