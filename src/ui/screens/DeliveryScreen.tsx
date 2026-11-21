import { useState } from 'react';
import { auditLeaving, type AuditAlert } from '../../audit/audit';
import { effectiveAddress, formatAddress, PROPERTY_LABEL } from '../../domain/address';
import { colorOf } from '../../domain/colors';
import type { Stop } from '../../domain/types';
import { shortLabel } from '../../domain/packages';
import { googleMapsLink, wazeLink } from '../../integrations/waze';
import { currentStopId, physicalBag, plannedStopId, groupOfStop, isPending, nextStopId, orderedStops, pendingVisits, useStore } from '../../store/store';
import '../shosho/shosho.css';
import { GoalLine } from '../components/GoalLine';
import { Chips, Modal } from '../components/common';
import { geoText, StopEditor } from '../components/StopEditor';
import { LabelCheck } from '../components/LabelCheck';
import { optimizeRoute } from '../../services/pipeline';
import { cargoPosition } from '../../optimize/loading';

const FAIL_REASONS = ['Destinatário ausente', 'Endereço não encontrado', 'Recusado', 'Local fechado', 'Acesso impedido'];

export function DeliveryScreen() {
  const store = useStore();
  const session = store.session!;
  const curId = currentStopId(session);
  const cur = curId ? session.stops[curId] : undefined;
  const [selected, setSelected] = useState<string[]>([]);
  const [mismatchAt, setMismatchAt] = useState<string>();
  const [failOpen, setFailOpen] = useState(false);
  const [failReason, setFailReason] = useState('');
  const [date, setDate] = useState('');
  const [planning, setPlanning] = useState(false);
  const [planMessage, setPlanMessage] = useState('');
  const [alerts, setAlerts] = useState<{ list: AuditAlert[]; from: string; next?: string } | null>(null);
  const [justification, setJustification] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [seqOpen, setSeqOpen] = useState(false);

  const all = orderedStops(session);
  const totalPk = all.reduce((s, x) => s + x.packages.length, 0);
  const donePk = all.reduce((s, x) => s + x.packages.filter((p) => p.status !== 'pending').length, 0);

  /** Depois de agir sobre a parada atual: audita a saída e avança (ou fica, se ainda há pendência parcial). */
  const advance = (fromId: string, skipping = false) => {
    const s = useStore.getState().session!;
    const from = s.stops[fromId];
    if (!skipping && isPending(from)) { setSelected([]); return; } // entrega parcial: continua aqui
    if (s.detour?.stopId === fromId) { setSelected([]); store.endDetour(); window.scrollTo({ top: 0 }); return; } // volta para a parada planejada
    const next = nextStopId(s, fromId);
    const list = auditLeaving(from, next ? s.stops[next] : undefined, Object.values(s.stops), s ? useStore.getState().settings.dividerName : undefined);
    setSelected([]);
    if (list.length) { store.setCursor(fromId); setAlerts({ list, from: fromId, next }); setJustification(''); return; }
    store.setCursor(next);
    window.scrollTo({ top: 0 });
  };

  const pendingIds = (st: Stop) => st.packages.filter((p) => p.status === 'pending').map((p) => p.id);
  const goTo = (next?: string) => {
    if (!cur || cur.id === next) return;
    setSelected([]);
    const list = auditLeaving(cur, next ? session.stops[next] : undefined, all, store.settings.dividerName);
    if (list.length) { store.setCursor(cur.id); setAlerts({ from: cur.id, next, list }); setJustification(''); }
    else store.setCursor(next);
  };
  const target = (st: Stop) => {
    const pending = pendingIds(st);
    if (mismatchAt === st.id) return [];
    return pending.length === 1 && st.packages.length === 1 ? pending : pending.filter(id => selected.includes(id));
  };

  const onDelivered = () => {
    if (!cur || !target(cur).length) return;
    store.setPackagesStatus(cur.id, 'delivered', { packageIds: target(cur) });
    store.markSkipped(cur.id, false);
    advance(cur.id);
  };
  const onFailed = () => {
    if (!cur || !target(cur).length || !failReason.trim()) return;
    store.setPackagesStatus(cur.id, 'failed', { packageIds: target(cur), reason: failReason.trim() });
    store.addAudit({ at: Date.now(), kind: 'nao-entregue', stopId: cur.id, justification: failReason.trim(), pendingStopIds: [] });
    store.markSkipped(cur.id, false);
    setFailOpen(false); setFailReason('');
    advance(cur.id);
  };
  const onSkip = () => {
    if (!cur) return;
    store.markSkipped(cur.id, true);
    store.addAudit({ at: Date.now(), kind: 'pulou', stopId: cur.id, justification: 'Pulado por enquanto', pendingStopIds: [cur.id] });
    advance(cur.id, true);
  };

  const continueAnyway = (why?: string) => {
    const justification2 = (why ?? justification).trim();
    if (!alerts || !justification2) return;
    const ids = [...new Set(alerts.list.flatMap((a) => a.stopIds))];
    store.addAudit({
      at: Date.now(),
      kind: alerts.list.some((a) => a.kind === 'antes-de-atravessar') ? 'atravessou-com-pendencia' : 'saiu-com-pendencia',
      stopId: alerts.from, justification: justification2, pendingStopIds: ids,
    });
    store.setCursor(alerts.next);
    setAlerts(null);
    window.scrollTo({ top: 0 });
  };

  const recent = [...session.audit].reverse();
  const lastDone = all.filter((s) => s.packages.some((p) => p.status !== 'pending')).sort((a, b) => maxAt(b) - maxAt(a)).slice(0, 3);

  if (!cur) {
    return (
      <div className="screen">
        <h2>Rota concluída</h2>
        <div className="ok">Todas as paradas foram tratadas: {donePk} de {totalPk} pacotes marcados.</div>
        <p className="muted">Veja não entregues e justificativas na aba Relatório.</p>
        <UndoList stops={lastDone} />
      </div>
    );
  }

  const group = groupOfStop(session, cur.id);
  const addr = effectiveAddress(cur);
  const waze = wazeLink(cur);
  const pos = session.plan.order.indexOf(cur.id) + 1;
  const doneHere = !isPending(cur);
  const threshold = store.settings.collectionThreshold;
  const isCollection = !!group?.special || cur.packages.length >= threshold;

  // Sacola física: a registrada em "Carreguei o carro"; antes disso, a do plano.
  const bagOf = (id: string) => physicalBag(session, id);
  const bag = bagOf(cur.id);
  const bagColor = bag ? colorOf(bag.colorKey) : undefined;
  const visits = pendingVisits(session);
  const next2 = visits.filter(id => id !== cur.id).slice(0, 2);
  const pend = cur.packages.filter(p => p.status === 'pending');
  const street = (st: Stop) => { const x = effectiveAddress(st); return x.number ? `${x.street}, ${x.number}` : x.street; };
  const BagMini = ({ id }: { id: string }) => { const b = bagOf(id); return b ? <span className="ss-bag" style={{ fontSize: 13, fontWeight: 700 }}><span className="ss-sw sm" style={{ ['--bc' as string]: colorOf(b.colorKey).bg }} />Sacola {b.index}</span> : null; };

  return (
    <div className="ss ss-body">
      <GoalLine />
      <div className="ss-topline">
        <span>Parada <b>{pos}</b> de {all.length}</span>
        <span>{donePk}/{totalPk} pacotes</span>
      </div>
      <div className="ss-prog" style={{ marginBottom: 10 }}><div style={{ width: `${(donePk / totalPk) * 100}%` }} /></div>

      {/* 1) parada atual: rua e número, bairro, sacola e pacotes */}
      {session.detour?.stopId === cur.id ? (() => { const pid = plannedStopId({ ...session, detour: undefined }); const p = pid ? session.stops[pid] : undefined; return <div className="ss-detour"><span>Fora da ordem · depois volta para {p ? street(p) : 'a sequência'}</span><button className="ss-linkbtn" onClick={() => { store.endDetour(); setSelected([]); }}>Voltar à planejada</button></div>; })() : null}
      <div className="ss-stop" style={{ ['--bc' as string]: bagColor?.bg ?? '#999' }}>
        <div className="ss-stop-top">
          {bag ? <span className="ss-bag"><span className="ss-sw" style={{ ['--bc' as string]: bagColor!.bg }} />Pegue na sacola {bag.index} · {bagColor!.name}</span> : <span className="ss-bag">Sem sacola definida</span>}
          <span className="ss-count">{cur.packages.length} pacote{cur.packages.length > 1 ? 's' : ''}</span>
        </div>
        <div className="ss-street">{street(cur)}</div>
        <div className="ss-hood">{[addr.district, addr.city].filter(Boolean).join(' · ')}{isCollection ? ' · ponto de coleta' : ''}</div>
        <div className="ss-pk">
          {cur.packages.map((p) => (
            <button
              key={p.id}
              className={p.status === 'delivered' ? 'done' : p.status === 'pending' ? (selected.includes(p.id) ? 'sel' : '') : 'fail'}
              disabled={p.status !== 'pending'}
              aria-label={`Pacote ${shortLabel(p)}`}
              onClick={() => { setMismatchAt(undefined); setSelected((x) => (x.includes(p.id) ? x.filter((y) => y !== p.id) : [...x, p.id])); }}
            >
              {shortLabel(p)}{p.extra && (p.tracking || p.trackingSuffix) ? <small>…{(p.tracking ?? p.trackingSuffix)!.slice(-5)}</small> : null}
            </button>
          ))}
        </div>
        {pend.length > 1 ? <div className="ss-pk-hint">{selected.length ? `${selected.length} de ${pend.length} selecionados` : 'Leia o código ou toque nos pacotes que vai entregar.'}</div> : null}
        {doneHere ? (
          <div className="ss-pk-hint" style={{ color: 'var(--go)', fontWeight: 700 }}>
            Parada já tratada. <button className="ss-linkbtn" onClick={() => store.setPackagesStatus(cur.id, 'pending', { packageIds: cur.packages.map((p) => p.id) })}>Corrigir engano</button>
          </div>
        ) : null}
      </div>

      {/* 2) os dois próximos endereços — antes dos controles de baixa */}
      <div className="ss-next">
        <div className="ss-next-h"><span>A seguir</span><button onClick={() => setSeqOpen(true)}>Ver sequência completa</button></div>
        {next2.length ? next2.map((id, i) => {
          const st = session.stops[id];
          return (
            <div className="ss-nrow" key={id}>
              <span className="ss-nnum">{i + 1}</span>
              <span className="ss-ntext"><b>{street(st)}</b><span>{effectiveAddress(st).district || '—'} · </span><BagMini id={id} /></span>
            </div>
          );
        }) : <div className="ss-nrow"><span className="ss-ntext"><span>Esta é a última parada pendente.</span></span></div>}
      </div>

      {/* 3) controles */}
      <div className="ss-actions">
        <a className="ss-btn nav" href={waze.url} target="_blank" rel="noopener noreferrer">Navegar no Waze</a>
        <LabelCheck key={cur.id} current={cur} stops={all} onMatch={id => { setMismatchAt(undefined); setSelected(x => x.includes(id) ? x : [...x, id]); }} onMismatch={() => { setMismatchAt(cur.id); }} />
        {mismatchAt === cur.id && <div className="ss-warnline">Leia a etiqueta correta ou toque no número do pacote desta parada.</div>}
        <div className="ss-row2">
          <button className="ss-btn go" disabled={!target(cur).length} onClick={onDelivered}>✓ Entregue ({target(cur).length})</button>
          <button className="ss-btn bad" disabled={!target(cur).length} onClick={() => setFailOpen(true)}>Ocorrência</button>
          <button className="ss-btn ghost" disabled={doneHere} onClick={onSkip}>Pular</button>
        </div>
      </div>

      {/* 4) detalhes */}
      <details className="ss-more">
        <summary>Ver mais ▾</summary>
        <dl className="ss-kv">
          <dt>Complemento</dt><dd>{cur.complement || '—'}</dd>
          <dt>Observação</dt><dd>{cur.notes || '—'}</dd>
          <dt>Imóvel</dt><dd>{cur.propertyType === 'desconhecido' ? 'Não informado' : PROPERTY_LABEL[cur.propertyType]}</dd>
          <dt>Destino no Waze</dt><dd>{waze.hint}</dd>
          <dt>Localização</dt><dd>{geoText(cur.geo)}</dd>
          {bag && session.carLoad ? <><dt>No carro</dt><dd>{cargoPosition(session.carLoad.findIndex(b => b.index === bag.index), session.carLoad.length)}</dd></> : null}
        </dl>
        {cur.corrected ? <div className="ss-warnline">Endereço corrigido. Original Shopee: {formatAddress(cur.original, false)}</div> : null}
        {cur.flags.map((f) => <div key={f} className="ss-warnline">{f}</div>)}
        <div className="ss-kv" style={{ display: 'block', marginTop: 8 }}>
          <div style={{ fontSize: 13, color: 'var(--soft)', marginBottom: 6 }}>Baixa no app da Shopee (separada da entrega física)</div>
          <div className="ss-pk" style={{ marginTop: 0 }}>
            {cur.packages.map(pkg => <button key={pkg.id} className={pkg.shopeeClosed ? 'sel' : ''} onClick={() => store.setClosed(cur.id, pkg.id, !pkg.shopeeClosed)}>{pkg.shopeeClosed ? '✓ ' : ''}{shortLabel(pkg)}</button>)}
          </div>
        </div>
        <div className="ss-links">
          <a href={googleMapsLink(cur)} target="_blank" rel="noopener noreferrer">Abrir no Google Maps</a>
          <button disabled={pos <= 1} onClick={() => goTo(session.plan.order[pos - 2])}>← Voltar à parada anterior</button>
          <button disabled={doneHere} onClick={() => { const pinned = !session.pinnedLast?.includes(cur.id); store.pinLast(cur.id, pinned); if (pinned) advance(cur.id, true); }}>{session.pinnedLast?.includes(cur.id) ? 'Tirar do final' : 'Deixar esta parada para o final'}</button>
          <button onClick={() => setEditing(cur.id)}>Corrigir endereço ou localização</button>
        </div>
        <details className="ss-sub-more"><summary>Escolher outra parada e replanejar</summary>
          <select aria-label="Escolher parada pendente" value={cur.id} onChange={e => goTo(e.target.value)}>
            {all.filter(st => isPending(st) || st.id === cur.id).map(st => <option key={st.id} value={st.id}>{formatAddress(effectiveAddress(st))}</option>)}
          </select>
          <button className="ss-btn ghost" style={{ width: '100%', marginTop: 8 }} disabled={planning || doneHere || !cur.geo || !!session.pinnedLast?.includes(cur.id)} onClick={async () => {
            setPlanning(true); setPlanMessage('Consultando os tempos de carro…');
            try { await optimizeRoute(() => {},undefined,cur.geo,cur.id); setPlanMessage('Pendências recalculadas a partir desta parada. As sacolas continuam as do carregamento.'); }
            catch (e) { setPlanMessage((e as Error).message); }
            finally { setPlanning(false); }
          }}>Recalcular a partir desta parada</button>
          {planMessage && <p role="status">{planMessage}</p>}
        </details>
        <UndoList stops={lastDone} />
        {recent.length ? <div className="ss-pk-hint">Último registro: {recent[0].justification}</div> : null}
      </details>

      {seqOpen ? (
        <div className="ss-sheet-bg" onClick={() => setSeqOpen(false)}>
          <div className="ss-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Sequência completa">
            <div className="ss-sheet-h"><b>Sequência completa</b><button onClick={() => setSeqOpen(false)}>Voltar à parada atual</button></div>
            <div className="ss-sheet-list">
              {all.map((st, i) => (
                <div key={st.id} className={`ss-seq ${st.id === cur.id ? 'cur' : ''} ${!isPending(st) ? 'done' : ''}`}>
                  <span className="n">{i + 1}</span>
                  <span className="t"><b>{street(st)}</b><span>{effectiveAddress(st).district || '—'} · {st.packages.map(shortLabel).join(' ')}</span></span>
                  <BagMini id={st.id} />
                  {isPending(st) && st.id !== cur.id ? <button className="ss-exitbtn" onClick={() => { store.startDetour(st.id); setSeqOpen(false); setSelected([]); window.scrollTo({ top: 0 }); }}>Fazer esta agora</button> : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <Modal open={failOpen} title="Não entregue" onClose={() => setFailOpen(false)}>
        <div className="stack">
          {(() => {
            const d = new Date(); do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
            const next = d.toISOString().slice(0, 10);
            const label = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
            return <button className="btn primary big" disabled={!target(cur).length} onClick={() => {
              const ids = target(cur);
              store.setPackagesStatus(cur.id, 'rescheduled', { packageIds: ids, date: date || next, reason: 'Volto outro dia — baixa na Shopee, cliente avisado' });
              for (const id of ids) store.setClosed(cur.id, id, true);
              setFailOpen(false); setDate(''); setFailReason(''); advance(cur.id);
            }}>Volto outro dia ({date ? new Date(date + 'T12:00').toLocaleDateString('pt-BR') : label}) · já dei baixa na Shopee</button>;
          })()}
          {FAIL_REASONS.map((r) => <button key={r} className={`btn ${failReason === r ? 'primary' : ''}`} onClick={() => setFailReason(r)}>{r}</button>)}
          <input value={failReason} onChange={(e) => setFailReason(e.target.value)} placeholder="Outro motivo" />
          <button className="btn danger big" disabled={!failReason.trim()} onClick={onFailed}>Registrar não entrega</button>
          <label>Data combinada para nova entrega <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          <button className="btn" disabled={!date || !target(cur).length} onClick={() => {
            store.setPackagesStatus(cur.id,'rescheduled',{packageIds:target(cur),date});
            setFailOpen(false); setDate(''); setFailReason(''); advance(cur.id);
          }}>Registrar reagendamento</button>
        </div>
      </Modal>

      <Modal open={!!alerts} title="Auditoria antes de sair" onClose={() => setAlerts(null)}>
        <div className="stack">
          {alerts?.list.map((a, i) => (
            <div key={i} className="warn">
              <b>{a.title}</b>
              <pre className="pre">{a.message}</pre>
              <div className="row wrap">
                {a.stopIds.slice(0, 4).map((id) => (
                  <button key={id} className="btn small" onClick={() => { store.setCursor(id); store.markSkipped(id, false); setAlerts(null); }}>
                    Ir para {useStore.getState().session!.stops[id].packages.filter((p) => p.status === 'pending').map((p) => shortLabel(p)).join(' ')}{(() => { const b = physicalBag(useStore.getState().session!, id); return b ? ` · Sacola ${b.index} ${colorOf(b.colorKey).name}` : ''; })()}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="lbl">Ou continuar para a próxima parada com justificativa (as pendências continuam registradas):</div>
          <input value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Ex.: volto depois, portão fechado" />
          <button className="btn big" disabled={!justification.trim()} onClick={() => continueAnyway()}>Continuar mesmo assim</button>
          <button className="btn primary big" onClick={() => continueAnyway('Seguindo a ordem da rota (pendências ficam para depois)')}>Seguir a ordem da rota</button>
        </div>
      </Modal>

      {editing ? <StopEditor stopId={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function maxAt(s: Stop) {
  return Math.max(0, ...s.packages.map((p) => p.updatedAt ?? 0));
}

function UndoList({ stops }: { stops: Stop[] }) {
  const store = useStore();
  if (!stops.length) return null;
  return (
    <details className="box">
      <summary>Desfazer marcação recente</summary>
      {stops.map((st) => (
        <div key={st.id} className="row between">
          <span className="small"><Chips packages={st.packages} /> {formatAddress(effectiveAddress(st), false)}</span>
          <button className="btn small" onClick={() => { store.setPackagesStatus(st.id, 'pending', { packageIds: st.packages.filter((p) => p.status !== 'pending').map((p) => p.id) }); store.setCursor(st.id); }}>Desfazer</button>
        </div>
      ))}
    </details>
  );
}
