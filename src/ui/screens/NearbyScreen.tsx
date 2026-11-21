import { useRef, useState } from 'react';
import { colorOf } from '../../domain/colors';
import { effectiveAddress } from '../../domain/address';
import type { RoutePlan, Stop } from '../../domain/types';
import { findNearby, fmtDrive, MAX_ACCURACY_M, type NearbyResult } from '../../services/nearby';
import { optimizeRoute } from '../../services/pipeline';
import { osrmProvider } from '../../services/routing/osrm';
import type { LatLng } from '../../services/routing/types';
import { isPending, physicalBag, plannedStopId, useStore } from '../../store/store';
import '../shosho/shosho.css';

const streetLine = (st: Stop) => { const a = effectiveAddress(st); return `${a.street}${a.number ? ', ' + a.number : ''}`; };
const pendingLabels = (st: Stop) => st.packages.filter(p => p.status === 'pending').map(p => p.label);

function Bag({ stopId }: { stopId: string }) {
  const s = useStore(x => x.session)!;
  const b = physicalBag(s, stopId);
  if (!b) return <span className="ss-bag">Sem sacola</span>;
  const c = colorOf(b.colorKey);
  return <span className="ss-bag"><span className="ss-sw" style={{ ['--bc' as string]: c.bg }} />Sacola {b.index} · {c.name}</span>;
}

/** Aba "Perto de mim": consulta entregas pendentes de todas as sacolas a partir do GPS, sem mudar a rota salva. */
export function NearbyScreen({ onGo }: { onGo: () => void }) {
  const session = useStore(x => x.session)!;
  const settings = useStore(x => x.settings);
  const [busy, setBusy] = useState('');
  const [warn, setWarn] = useState('');
  const [res, setRes] = useState<NearbyResult | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ plan: RoutePlan; base: typeof session; here: LatLng } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const plannedId = plannedStopId(session);
  const planned = plannedId ? session.stops[plannedId] : undefined;
  const detour = session.detour && isPending(session.stops[session.detour.stopId]) ? session.stops[session.detour.stopId] : undefined;

  const locate = () => new Promise<GeolocationPosition>((ok, fail) => {
    if (!('geolocation' in navigator)) return fail(new Error('Este aparelho não liberou o GPS para a ShoSho.'));
    navigator.geolocation.getCurrentPosition(ok, e => fail(new Error(e.code === 1 ? 'A ShoSho não tem permissão para usar o GPS. Ative em Ajustes › Privacidade › Localização.' : 'O GPS não respondeu. Tente de novo em céu aberto.')), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });

  const search = async () => {
    setWarn(''); setRes(null); setChosen(null); setPreview(null);
    abort.current?.abort(); const ac = new AbortController(); abort.current = ac;
    setBusy('Lendo o GPS do iPhone…');
    let p: GeolocationPosition;
    try { p = await locate(); } catch (e) { setBusy(''); setWarn(`${(e as Error).message} A rota salva continua igual.`); return; }
    const acc = Math.round(p.coords.accuracy);
    if (acc > MAX_ACCURACY_M) { setBusy(''); setWarn(`GPS impreciso agora (±${acc} m). Não dá para comparar as ruas com segurança. A rota salva continua igual. Tente de novo em alguns segundos, longe de prédios altos.`); return; }
    const here = { lat: p.coords.latitude, lng: p.coords.longitude };
    setBusy('Consultando o tempo de carro pelas ruas…');
    try {
      setRes(await findNearby(useStore.getState().session!, here, acc, osrmProvider(settings.osrmUrl), ac.signal));
    } catch (e) {
      if (ac.signal.aborted) return;
      setWarn(`Sem conexão com o serviço de ruas (${(e as Error).message}). Nada foi alterado: a rota salva continua igual. Siga a parada planejada e busque de novo quando a internet voltar.`);
    } finally { setBusy(''); }
  };

  const recalc = async () => {
    if (!res) return;
    setWarn(''); setBusy('Montando a nova sequência a partir daqui…');
    const base = useStore.getState().session!;
    try {
      const { plan } = await optimizeRoute(() => {}, undefined, res.here, undefined, false);
      setPreview({ plan, base, here: res.here });
    } catch (e) { setWarn(`${(e as Error).message}`); } finally { setBusy(''); }
  };
  const apply = () => {
    const st = useStore.getState();
    if (!preview || st.session !== preview.base) { setWarn('A rota mudou desde a prévia. Toque de novo em “Recalcular pendências daqui”.'); setPreview(null); return; }
    st.setPlan(preview.plan);
    st.addAudit({ at: Date.now(), kind: 'recalculo', stopId: preview.plan.order.find(id => isPending(preview.base.stops[id])) ?? '', justification: 'Pendências recalculadas pela aba Perto de mim', pendingStopIds: [] });
    setPreview(null); setRes(null); onGo();
  };

  const doNow = (id: string) => { useStore.getState().startDetour(id); onGo(); };

  return (
    <div className="screen ss">
      <h2 className="ss-h">Perto de mim</h2>

      {detour ? <div className="ss-warnline">Fora da ordem agora: {streetLine(detour)}. Depois dela você volta para a parada planejada.</div> : null}

      {planned ? <div className="ss-near-plan">
        <span className="muted small">Sua próxima parada planejada</span>
        <b>{streetLine(planned)}</b>
        <span className="small">{effectiveAddress(planned).district} · <Bag stopId={planned.id} /> · {pendingLabels(planned).join(' ')}</span>
        {res?.planned ? <span className="small">Daqui até ela: <b>{fmtDrive(res.planned.seconds)}</b> de carro</span> : null}
      </div> : <div className="info">Não há parada planejada pendente.</div>}

      <button className="ss-btn go" disabled={!!busy} onClick={search}>📍 Buscar pela minha localização</button>
      {busy ? <div className="info small">{busy}</div> : null}
      {warn ? <div className="ss-near-warn" role="alert">{warn}</div> : null}

      {res ? <>
        <div className="muted small">GPS ±{res.accuracy} m · tempos de carro pelas ruas (mão única, retornos e travessias da avenida). Não inclui o tempo de estacionar e entregar.</div>
        {res.options.length === 0 ? <div className="info">Nenhuma outra entrega pendente com localização.</div> : null}
        <ol className="ss-near">
          {res.options.map((o, i) => {
            const st = session.stops[o.stopId];
            const open = chosen === o.stopId;
            return <li key={o.stopId} className={'ss-near-card' + (open ? ' on' : '')}>
              <div className="ss-near-top"><span className="ss-nnum">{i + 1}</span><b className="ss-near-time">{fmtDrive(o.seconds)}</b><span className="muted small"> de carro · {Math.round(o.straightMeters)} m em linha reta</span></div>
              <div className="ss-near-street">{streetLine(st)}</div>
              <div className="small">{effectiveAddress(st).district || '—'} · <Bag stopId={st.id} /></div>
              <div className="ss-near-pk">{pendingLabels(st).map(l => <span key={l}>{l}</span>)}</div>
              {o.roundabout ? <div className="ss-near-flag warn">Parece perto no mapa, mas pelas ruas exige dar a volta ({(o.roadMeters / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km).</div> : null}
              {o.sameStreet.length ? <div className="ss-near-flag same">Mesma rua: mais {o.sameStreet.length} entrega{o.sameStreet.length > 1 ? 's' : ''} neste trecho — {o.sameStreet.map(id => { const x = session.stops[id]; const b = physicalBag(session, id); return `nº ${effectiveAddress(x).number || 's/n'}${b ? ` (sacola ${b.index})` : ''}`; }).join(', ')}</div> : null}
              {res.planned && o.viaSeconds !== undefined ? <div className="ss-near-cmp">
                <span>Direto para a planejada<b>{fmtDrive(res.planned.seconds)}</b></span>
                <span>Fazendo esta antes<b>{fmtDrive(o.viaSeconds)}</b></span>
                <span className="dv">Desvio estimado ao volante<b>+{fmtDrive(o.detourSeconds ?? 0)}</b></span>
              </div> : null}
              {!open ? <button className="ss-btn ghost" onClick={() => setChosen(o.stopId)}>Fazer esta agora</button> : <div className="ss-near-go">
                <div>Tire da <Bag stopId={st.id} />: <b>{pendingLabels(st).join(' ')}</b></div>
                <div className="small muted">Depois desta entrega, a ShoSho volta para {planned ? streetLine(planned) : 'a sequência planejada'}.</div>
                <div className="ss-row2"><button className="ss-btn go" onClick={() => doNow(o.stopId)}>Peguei · ir para ela</button><button className="ss-btn ghost" onClick={() => setChosen(null)}>Cancelar</button></div>
              </div>}
            </li>;
          })}
        </ol>

        {!preview ? <button className="ss-btn ghost" disabled={!!busy} onClick={recalc}>Recalcular pendências daqui</button> : <div className="ss-near-preview">
          <b>Prévia da nova sequência</b>
          <span className="small muted">Ao volante: {fmtDrive(preview.plan.totalSeconds ?? 0)} para todas as pendências. As sacolas continuam onde você guardou; entregas e baixas ficam como estão.{session.pinnedLast?.length ? ` ${session.pinnedLast.length} entrega(s) fixada(s) continuam no final.` : ''}</span>
          <ol className="ss-near-list">{preview.plan.order.filter(id => isPending(preview.base.stops[id])).slice(0, 5).map(id => <li key={id}><b>{streetLine(session.stops[id])}</b> · {effectiveAddress(session.stops[id]).district} · <Bag stopId={id} /></li>)}</ol>
          <div className="ss-row2"><button className="ss-btn go" onClick={apply}>Aplicar nova sequência</button><button className="ss-btn ghost" onClick={() => setPreview(null)}>Manter a rota atual</button></div>
        </div>}
      </> : null}
    </div>
  );
}
