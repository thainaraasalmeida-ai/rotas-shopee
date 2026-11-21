import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { addressKey, effectiveAddress } from '../domain/address';
import type { Address, AuditEntry, GeoPoint, ImportIssue, ImportResult, PackageStatus, PropertyType, RoutePlan, Stop } from '../domain/types';
import { importedPlan } from '../optimize/plan';
import { detectCollectionPoints, regroup, type SpecialKind } from '../optimize/special';
import { parseBackup, safeStorage } from './persistence';
import { combineTracking } from '../importers/combine';

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
  pinnedLast?: string[];
  carLoad?: { index:number; colorKey:string; stopIds:string[] }[];
  /** Entrega feita fora da ordem ("Perto de mim"); ao terminar, volta para a parada planejada. */
  detour?: { stopId: string; startedAt: number };
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
  corrections?: Record<string, Address>;
  /** Pontos de coleta que o usuário marcou à mão em rotas anteriores (por endereço). */
  learnedCollectionPoints: Record<string, { label: string; at: number }>;

  loadImport(r: ImportResult): void;
  linkManifest(r: ImportResult): void;
  clearSession(): void;
  setPlan(plan: RoutePlan): void;
  saveCarLoad(bags:NonNullable<Session['carLoad']>):void;
  restoreBackup(text: string): void;
  updateStop(id: string, patch: Partial<Stop>): void;
  setPackagesStatus(stopId: string, status: PackageStatus, opts?: { packageIds?: string[]; reason?: string; date?: string }): void;
  setClosed(stopId: string, packageId: string, closed: boolean): void;
  correctAddress(stopId: string, a: Address | undefined, note?: string): void;
  confirmPropertyType(stopId: string, t: PropertyType): void;
  setGeo(stopId: string, geo: GeoPoint | undefined): void;
  setCursor(stopId: string | undefined): void;
  startDetour(stopId: string): void;
  endDetour(): void;
  pinLast(stopId: string, pinned: boolean): void;
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
          const corrected = get().corrections?.[addressKey(s.original)];
          const v = verified[addressKey(corrected ?? s.original)];
          stops[s.id] = corrected ? { ...s, corrected, geo: v, correctionNote: 'Correção salva em rota anterior' } : v ? { ...s, geo: v } : s;
        }
        const groupCount = r.groups.length || get().settings.groupCount;
        const specials: Record<string, SpecialKind> = {};
        // PDF já organizado em grupos (ex.: rota do Thiago): NÃO cria grupos novos — a separação física já foi feita.
        if (!r.groups.length) for (const id of detectCollectionPoints(r.stops, get().settings.collectionThreshold)) specials[id] = 'auto';
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
      linkManifest(r) {
        const s = get().session;
        if (!s || s.source !== 'pdf' || r.source !== 'planilha' || r.issues.some(i => i.level === 'erro')) throw new Error('Confira os arquivos antes de vincular.');
        const stops = combineTracking(Object.values(s.stops),r.stops);
        set({session:{...s,stops:Object.fromEntries(stops.map(st => [st.id,st])),plan:{...s.plan,stale:true}}});
      },
      setPlan(plan) {
        const s = get().session;
        if (!s) return;
        // Grupos especiais são preservados em qualquer recálculo.
        const groups = plan.groups === s.plan.groups ? s.plan.groups : regroup(plan.order, plan.groups, s.specials ?? {});
        set({ session: { ...s, plan: { ...plan, groups }, cursor: undefined, detour: undefined } });
      },
      restoreBackup(text) {
        const { state } = parseBackup(text);
        const st = state as Partial<State>;
        set({ session: (st.session ?? null) as Session | null, settings: { ...get().settings, ...(st.settings ?? {}) }, verifiedGeo: st.verifiedGeo ?? get().verifiedGeo, corrections: st.corrections ?? get().corrections, learnedCollectionPoints: st.learnedCollectionPoints ?? get().learnedCollectionPoints });
      },
      saveCarLoad(bags) {
        const s = get().session;
        if (s && canPrepareBags(s)) set({session:{...s,carLoad:bags}});
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
        if (s.source === 'pdf' && s.plan.method === 'importado' && s.specials === undefined) {
          set({ session: { ...s, specials: {}, specialDeclined: [], suggestionsDismissed: [] } });
          return;
        }
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
        if (!st || (status === 'rescheduled' && !opts?.date)) return;
        const at = Date.now();
        const audit = [...s.audit];
        const names: Record<PackageStatus,string> = {pending:'pendente', delivered:'entregue fisicamente', failed:'ocorrência', rescheduled:'reagendado'};
        const packages = st.packages.map(p => {
          if (opts?.packageIds && !opts.packageIds.includes(p.id)) return p;
          if (p.status === status && p.rescheduledFor === opts?.date && p.failReason === opts?.reason) return p;
          audit.push({at, kind:'pacote', stopId, packageId:p.id, pendingStopIds:[], justification:[p.label, p.tracking, names[p.status] + ' → ' + names[status], opts?.date, opts?.reason].filter(Boolean).join(' · ')});
          return {...p, status, failReason: status === 'failed' ? opts?.reason : undefined, rescheduledFor: status === 'rescheduled' ? opts?.date : undefined, updatedAt:at};
        });
        set({session:{...s, audit, stops:{...s.stops,[stopId]:{...st,packages}}}});
      },
      setClosed(stopId, packageId, closed) {
        const s = get().session;
        const st = s?.stops[stopId];
        const pkg = st?.packages.find(p => p.id === packageId);
        if (!s || !st || !pkg || !!pkg.shopeeClosed === closed) return;
        const packages = st.packages.map(p => p.id === packageId ? {...p,shopeeClosed:closed} : p);
        set({session:{...s, stops:{...s.stops,[stopId]:{...st,packages}}, audit:[...s.audit,{at:Date.now(),kind:'baixa',stopId,packageId,pendingStopIds:[], justification:[pkg.label,pkg.tracking,closed ? 'Baixa informada na Shopee' : 'Baixa desmarcada na ShoSho'].filter(Boolean).join(' · ')}]}});
      },
      correctAddress(stopId, a, note) {
        const s = get().session;
        if (!s) return;
        // O original da Shopee é preservado; só a correção muda. A localização é refeita.
        const st = s.stops[stopId];
        const corrections = {...get().corrections};
        if (a) corrections[addressKey(st.original)] = a; else delete corrections[addressKey(st.original)];
        const v = a ? get().verifiedGeo[addressKey(a)] : get().verifiedGeo[addressKey(st.original)];
        get().updateStop(stopId, { corrected: a, correctionNote: note, geo: v, dividerSide: undefined });
        const s2 = get().session!;
        set({
          corrections,
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
        set({session:{...s,stops:{...s.stops,[stopId]:{...s.stops[stopId],geo}},plan:{...s.plan,stale:true}}});
        if (geo?.verified) {
          const key = addressKey(effectiveAddress(s.stops[stopId]));
          set({ verifiedGeo: { ...get().verifiedGeo, [key]: geo } });
        }
      },
      startDetour(stopId) {
        const s = get().session;
        if (!s || !s.stops[stopId] || !isPending(s.stops[stopId])) return;
        const planned = currentStopId(s);
        set({ session: { ...s, detour: { stopId, startedAt: Date.now() }, cursor: s.detour ? s.cursor : planned } });
        get().addAudit({ at: Date.now(), kind: 'desvio', stopId, justification: 'Feita agora pela aba Perto de mim; a sequência planejada continua depois', pendingStopIds: planned ? [planned] : [] });
      },
      endDetour() {
        const s = get().session;
        if (!s?.detour) return;
        set({ session: { ...s, detour: undefined } });
      },
      setCursor(stopId) {
        const s = get().session;
        if (!s) return;
        set({ session: { ...s, cursor: stopId } });
      },
      pinLast(stopId, pinned) {
        const s = get().session;
        if (!s?.stops[stopId]) return;
        const pinnedLast = (s.pinnedLast ?? []).filter(id => id !== stopId);
        if (pinned) pinnedLast.push(stopId);
        const order = [...s.plan.order.filter(id => !pinnedLast.includes(id)), ...pinnedLast];
        set({session:{...s,pinnedLast,plan:{...s.plan,order,stale:true,totalSeconds:undefined},cursor:undefined}});
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
        const {settings,session} = get();
        if (!(Object.keys(p) as (keyof Settings)[]).some(key => settings[key] !== p[key])) return;
        set({settings:{...settings,...p},session:session ? {...session,plan:{...session.plan,stale:true}} : null});
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

export function canPrepareBags(s: Session) {
  return s.plan.order.length === 1 || (s.plan.method === 'malha-viaria' && !!s.plan.bagsByRoute && !s.plan.stale);
}

/** Visitas pendentes na mesma sequência usada ao confirmar cada parada, sem alterar o cursor. */
export function pendingVisits(s: Session): string[] {
  if (s.detour && s.stops[s.detour.stopId] && isPending(s.stops[s.detour.stopId])) {
    const d = s.detour.stopId;
    return [d, ...pendingVisits({ ...s, detour: undefined }).filter(id => id !== d)];
  }
  const remaining = {...s,stops:{...s.stops}};
  const visits: string[] = [];
  let id = currentStopId(s);
  while (id) {
    if (isPending(remaining.stops[id])) visits.push(id);
    remaining.stops[id] = {...remaining.stops[id],packages:[]};
    id = nextStopId(remaining,id);
  }
  return visits;
}

/** Próxima parada: segue a ordem; paradas puladas voltam no fim. */
export function nextStopId(s: Session, afterId?: string): string | undefined {
  const order = s.plan.order;
  const start = afterId ? order.indexOf(afterId) + 1 : 0;
  const candidates = [...order.slice(start), ...order.slice(0, start)];
  const eligible = candidates.filter(id => isPending(s.stops[id]));
  const ordinary = eligible.filter(id => !s.pinnedLast?.includes(id));
  const group = ordinary.length ? ordinary : eligible;
  const notSkipped = group.find((id) => id !== afterId && !s.skipped.includes(id));
  if (notSkipped) return notSkipped;
  return group.find(id => id !== afterId) ?? group[0];
}

export function currentStopId(s: Session): string | undefined {
  if (s.detour && s.stops[s.detour.stopId] && isPending(s.stops[s.detour.stopId])) return s.detour.stopId;
  // O cursor pode apontar para uma parada já marcada (ao "Voltar à parada anterior").
  if (s.cursor && s.stops[s.cursor]) return s.cursor;
  return nextStopId(s, undefined);
}

/** Sugestões aprendidas: endereços desta rota marcados como ponto de coleta em rotas anteriores (precisam de confirmação). */
export function collectionSuggestions(s: Session, learned: Record<string, { label: string; at: number }>): string[] {
  return Object.values(s.stops)
    .filter((st) => learned[addressKey(effectiveAddress(st))] && !(s.specials ?? {})[st.id] && !(s.suggestionsDismissed ?? []).includes(st.id))
    .map((st) => st.id);
}

/** Sacola física: a registrada em "Carreguei o carro"; antes disso, a sacola planejada. */
export function physicalBag(s: Session, stopId: string): { index: number; colorKey: string; special?: string; loaded: boolean } | undefined {
  const b = s.carLoad?.find(x => x.stopIds.includes(stopId));
  if (b) return { index: b.index, colorKey: b.colorKey, loaded: true };
  const g = groupOfStop(s, stopId);
  return g ? { index: g.index, colorKey: g.colorKey, special: g.special, loaded: false } : undefined;
}

/** Parada planejada, ignorando uma entrega fora da ordem em andamento. */
export function plannedStopId(s: Session): string | undefined {
  return currentStopId({ ...s, detour: undefined });
}
