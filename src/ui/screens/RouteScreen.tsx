import { useMemo, useRef, useState } from 'react';
import { effectiveAddress, formatAddress } from '../../domain/address';
import { colorOf, groupColorKey } from '../../domain/colors';
import { importedPlan } from '../../optimize/plan';
import { computeDividerSides, dividerCache, geocodeAll, optimizeRoute, type Progress } from '../../services/pipeline';
import { groupOfStop, orderedStops, useStore } from '../../store/store';
import { fmtMin, MethodBanner } from '../components/common';
import { MapView, type MapMarker } from '../components/MapView';
import { StopEditor } from '../components/StopEditor';

export function RouteScreen() {
  const { session, settings, setSettings, setPlan } = useStore();
  const s = session!;
  const [progress, setProgress] = useState<Progress | null>(null);
  const [log, setLog] = useState<{ cls: string; text: string }[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const stops = orderedStops(s);
  const located = stops.filter((x) => x.geo);
  const precise = located.filter((x) => x.geo!.verified || x.geo!.precision === 'numero' || x.geo!.precision === 'shopee');
  const missing = stops.filter((x) => !x.geo);
  const streetOnly = located.filter((x) => !x.geo!.verified && x.geo!.precision === 'rua');

  const say = (cls: string, text: string) => setLog((l) => [...l, { cls, text }]);

  const run = async (what: 'geo' | 'opt') => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setLog([]);
    try {
      if (what === 'geo') {
        const r = await geocodeAll(setProgress, ac.signal);
        say(r.failed ? 'warn' : 'ok', `${r.ok} endereço(s) localizado(s)${r.failed ? `, ${r.failed} não encontrado(s) — corrija ou marque no mapa` : ''}.`);
      } else {
        let start: { lat: number; lng: number } | undefined;
        if (settings.useGpsStart) {
          start = await new Promise((res) => navigator.geolocation?.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res(undefined), { timeout: 10000 }));
          say(start ? 'info' : 'warn', start ? 'Partida: sua localização atual.' : 'GPS indisponível; a rota começa pela parada mais conveniente.');
        }
        try {
          setProgress({ step: 'Buscando a avenida divisora no mapa', done: 0, total: 1 });
          say('info', await computeDividerSides(ac.signal));
        } catch (e) {
          say('warn', `Não consegui buscar a avenida divisora (${(e as Error).message}). A rota segue sem essa penalidade.`);
        }
        const { plan, warning } = await optimizeRoute(setProgress, ac.signal, start);
        if (warning) say('err', warning);
        say(plan.method === 'malha-viaria' ? 'ok' : 'warn', `Rota pronta: ${plan.groups.length} grupos, deslocamento estimado ${fmtMin(plan.totalSeconds)}${plan.importedSeconds ? ` (ordem do arquivo: ${fmtMin(plan.importedSeconds)})` : ''}.`);
      }
    } catch (e) {
      if (!ac.signal.aborted) say('err', (e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  const markers: MapMarker[] = useMemo(
    () =>
      stops.filter((x) => x.geo).map((x) => {
        const g = groupOfStop(s, x.id);
        return {
          id: x.id,
          lat: x.geo!.lat,
          lng: x.geo!.lng,
          color: g ? colorOf(g.colorKey).bg : '#888',
          text: String(s.plan.order.indexOf(x.id) + 1),
          dashed: !x.geo!.verified && x.geo!.precision === 'rua',
          popup: `${x.packages.map((p) => p.label).join(' ')} · ${formatAddress(effectiveAddress(x), false)}`,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.plan, s.stops],
  );
  const path = useMemo(() => markers.map((m) => [m.lat, m.lng] as [number, number]), [markers]);
  const divider = useMemo(() => dividerCache?.lines.map((l) => l.map((p) => [p.lat, p.lng] as [number, number])), [s.plan]);

  return (
    <div className="screen">
      <MethodBanner method={s.plan.method} stale={s.plan.stale} />
      <div className="stats">
        <div><big>{located.length}/{stops.length}</big>localizadas</div>
        <div><big>{precise.length}</big>no número/conferidas</div>
        <div><big>{streetOnly.length}</big>só pela rua</div>
        <div><big>{fmtMin(s.plan.totalSeconds)}</big>deslocamento</div>
      </div>
      {s.plan.importedSeconds && s.plan.totalSeconds ? (
        <div className="info">Mesma matriz de tempos: ordem do arquivo {fmtMin(s.plan.importedSeconds)} × otimizada {fmtMin(s.plan.totalSeconds)}.</div>
      ) : null}

      <div className="stack">
        <button className="btn primary big" disabled={!!progress} onClick={() => run('geo')}>1. Localizar endereços {missing.length ? `(${missing.length})` : '✔'}</button>
        <button className="btn primary big" disabled={!!progress || located.length < 2} onClick={() => run('opt')}>2. Otimizar pela malha viária</button>
        {progress ? (
          <div className="info">
            {progress.step}{progress.total > 1 ? ` — ${progress.done}/${progress.total}` : '…'}
            <button className="btn small" onClick={() => abort.current?.abort()}>Cancelar</button>
          </div>
        ) : null}
        {log.map((l, i) => <div key={i} className={l.cls}>{l.text}</div>)}
        {s.plan.notes.map((n, i) => <div key={i} className="muted small">• {n}</div>)}
      </div>

      <details className="box">
        <summary>Ajustes da otimização</summary>
        <div className="maprow"><span>Grupos comuns (fora os pontos de coleta)</span>
          <input type="number" min={1} max={12} value={settings.groupCount} onChange={(e) => setSettings({ groupCount: Math.max(1, Math.min(12, parseInt(e.target.value, 10) || 1)) })} />
        </div>
        <div className="maprow"><span>Ponto de coleta a partir de (pacotes no mesmo endereço)</span>
          <input type="number" min={2} max={200} value={settings.collectionThreshold} onChange={(e) => { setSettings({ collectionThreshold: Math.max(2, parseInt(e.target.value, 10) || 10) }); useStore.getState().applyAutoSpecials(); }} />
        </div>
        <div className="maprow"><span>Avenida divisora</span>
          <input value={settings.dividerName} onChange={(e) => setSettings({ dividerName: e.target.value })} />
        </div>
        <label className="maprow"><span>Considerar avenida divisora</span><input type="checkbox" checked={settings.dividerEnabled} onChange={(e) => setSettings({ dividerEnabled: e.target.checked })} /></label>
        <label className="maprow"><span>Partir da minha localização</span><input type="checkbox" checked={settings.useGpsStart} onChange={(e) => setSettings({ useGpsStart: e.target.checked })} /></label>
        <div className="maprow"><span>Servidor OSRM</span>
          <input value={settings.osrmUrl} onChange={(e) => setSettings({ osrmUrl: e.target.value })} />
        </div>
        <button className="btn" onClick={() => setPlan(importedPlan(Object.values(s.stops).sort((a, b) => s.importedOrder.indexOf(a.id) - s.importedOrder.indexOf(b.id)), s.source === 'pdf' ? rebuildImportedGroups(s) : [], settings.groupCount, Object.keys(s.specials ?? {})))}>
          Voltar para a ordem do arquivo
        </button>
      </details>

      {markers.length ? <MapView markers={markers} path={path} divider={divider} onMarkerClick={setEditing} /> : <div className="muted">O mapa aparece depois de localizar os endereços.</div>}
      <div className="muted small">Marcador tracejado = localizado só pela rua. Toque para corrigir ou marcar a posição exata.</div>

      {located.length && (missing.length || streetOnly.length) ? (
        <div className="stack">
          <h3>Conferir localização</h3>
          {[...missing, ...streetOnly].map((x) => (
            <button key={x.id} className="next-row" onClick={() => setEditing(x.id)}>
              <span className="small">{x.packages.map((p) => p.label).join(' ')}</span>
              <span className="small">{formatAddress(effectiveAddress(x), false)} — {x.geo ? 'só a rua' : 'não localizado'}</span>
            </button>
          ))}
        </div>
      ) : null}
      {editing ? <StopEditor stopId={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function rebuildImportedGroups(s: NonNullable<ReturnType<typeof useStore.getState>['session']>) {
  const byGroup = new Map<number, string[]>();
  for (const id of s.importedOrder) {
    const g = s.stops[id].importedGroup;
    if (g === undefined) continue;
    byGroup.set(g, [...(byGroup.get(g) ?? []), id]);
  }
  return [...byGroup].map(([index, stopIds]) => ({ index, colorKey: groupColorKey(index), name: s.importedGroupNames[index], stopIds }));
}
