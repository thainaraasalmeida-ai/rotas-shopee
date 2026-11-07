import { useState } from 'react';
import { auditLeaving, type AuditAlert } from '../../audit/audit';
import { effectiveAddress, formatAddress, PROPERTY_LABEL } from '../../domain/address';
import { colorOf } from '../../domain/colors';
import type { Stop } from '../../domain/types';
import { shortLabel } from '../../domain/packages';
import { googleMapsLink, wazeLink } from '../../integrations/waze';
import { currentStopId, groupOfStop, isPending, nextStopId, orderedStops, useStore } from '../../store/store';
import { Chips, GroupBadge, MethodBanner, Modal } from '../components/common';
import { geoText, StopEditor } from '../components/StopEditor';

const FAIL_REASONS = ['Destinatário ausente', 'Endereço não encontrado', 'Recusado', 'Local fechado', 'Acesso impedido'];

export function DeliveryScreen() {
  const store = useStore();
  const session = store.session!;
  const curId = currentStopId(session);
  const cur = curId ? session.stops[curId] : undefined;
  const [selected, setSelected] = useState<string[]>([]);
  const [failOpen, setFailOpen] = useState(false);
  const [failReason, setFailReason] = useState('');
  const [alerts, setAlerts] = useState<{ list: AuditAlert[]; from: string; next?: string } | null>(null);
  const [justification, setJustification] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  const all = orderedStops(session);
  const totalPk = all.reduce((s, x) => s + x.packages.length, 0);
  const donePk = all.reduce((s, x) => s + x.packages.filter((p) => p.status !== 'pending').length, 0);
  const doneStops = all.filter((s) => !isPending(s)).length;

  /** Depois de agir sobre a parada atual: audita a saída e avança (ou fica, se ainda há pendência parcial). */
  const advance = (fromId: string, skipping = false) => {
    const s = useStore.getState().session!;
    const from = s.stops[fromId];
    if (!skipping && isPending(from)) { setSelected([]); return; } // entrega parcial: continua aqui
    const next = nextStopId(s, fromId);
    const list = auditLeaving(from, next ? s.stops[next] : undefined, Object.values(s.stops), s ? useStore.getState().settings.dividerName : undefined);
    setSelected([]);
    if (list.length) { setAlerts({ list, from: fromId, next }); setJustification(''); return; }
    store.setCursor(next);
    window.scrollTo({ top: 0 });
  };

  const pendingIds = (st: Stop) => st.packages.filter((p) => p.status === 'pending').map((p) => p.id);
  const target = (st: Stop) => (selected.length ? selected : pendingIds(st));

  const onDelivered = () => {
    if (!cur) return;
    store.setPackagesStatus(cur.id, 'delivered', { packageIds: target(cur) });
    store.markSkipped(cur.id, false);
    advance(cur.id);
  };
  const onFailed = () => {
    if (!cur || !failReason.trim()) return;
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
  const c = group ? colorOf(group.colorKey) : undefined;
  const addr = effectiveAddress(cur);
  const waze = wazeLink(cur);
  const pos = session.plan.order.indexOf(cur.id) + 1;
  const doneHere = !isPending(cur);
  const threshold = store.settings.collectionThreshold;
  const isCollection = !!group?.special || cur.packages.length >= threshold;
  const upcoming: string[] = [];
  let probe: string | undefined = cur.id;
  for (let i = 0; i < 4; i++) {
    probe = nextStopId({ ...session, skipped: [...session.skipped] }, probe);
    if (!probe || probe === cur.id || upcoming.includes(probe)) break;
    upcoming.push(probe);
  }

  return (
    <div className="screen">
      <h2 className="stop-count">Parada {pos} de {all.length}</h2>
      <div className="progress"><div style={{ width: `${(donePk / totalPk) * 100}%` }} /></div>
      <div className="muted small">{doneStops} paradas concluídas · {donePk} de {totalPk} pacotes marcados</div>
      {session.plan.method === 'linha-reta' ? <MethodBanner method={session.plan.method} stale={session.plan.stale} /> : null}

      <div className="card" style={{ borderColor: c?.bg }}>
        <GroupBadge group={group} big />
        {session.skipped.includes(cur.id) ? <div className="warn">Esta parada foi pulada antes.</div> : null}
        {doneHere ? (
          <div className={cur.packages.every((p) => p.status === 'delivered') ? 'ok' : 'err'}>
            <b>Parada já marcada:</b> {cur.packages.filter((p) => p.status === 'delivered').length} entregue(s), {cur.packages.filter((p) => p.status === 'failed').length} não entregue(s).
            <div className="row wrap" style={{ marginTop: 8 }}>
              <button className="btn small" onClick={() => store.setPackagesStatus(cur.id, 'pending', { packageIds: cur.packages.map((p) => p.id) })}>Desfazer marcação</button>
              <button className="btn small" onClick={() => store.setCursor(nextStopId(session, cur.id))}>Ir para a próxima pendente</button>
            </div>
          </div>
        ) : null}
        {isCollection ? (
          <div className="coleta">PONTO DE COLETA · {cur.packages.length} pacotes{group ? ` · sacola exclusiva${group.special ? '' : ` dentro do Grupo ${group.index}`}` : ''}</div>
        ) : null}
        <div className="labels-big" style={{ color: c?.bg }}>
          {cur.packages.map((p) => (
            <button
              key={p.id}
              className={`lbl-btn st-${p.status} ${selected.includes(p.id) ? 'sel' : ''}`}
              disabled={p.status !== 'pending'}
              onClick={() => setSelected((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]))}
            >
              {shortLabel(p)}
            </button>
          ))}
        </div>
        <div className="muted small">{cur.packages.length} pacote(s){cur.packages.some((p) => p.extra) ? ' (inclui adicional sem número)' : ''} · toque nas etiquetas para marcar só algumas</div>

        <div className="addr">{formatAddress(addr, false)}</div>
        <div className="muted">{addr.district} · {addr.city}</div>
        {cur.corrected ? <div className="warn small">Endereço corrigido. Original Shopee: {formatAddress(cur.original, false)}</div> : null}
        <dl className="facts">
          <dt>Complemento</dt><dd>{cur.complement || '—'}</dd>
          <dt>Imóvel</dt><dd>{cur.propertyType === 'desconhecido' ? 'Não informado' : `${PROPERTY_LABEL[cur.propertyType]}${cur.propertyTypeSource === 'confirmado' ? ' ✔' : ' (inferido)'}`}</dd>
          <dt>Quantidade</dt><dd>{cur.packages.length}</dd>
          <dt>Observações</dt><dd>{cur.notes || '—'}</dd>
        </dl>
        {cur.flags.map((f) => <div key={f} className="warn">{f}</div>)}

        <a className="btn waze big nav-big" href={waze.url} target="_blank" rel="noopener noreferrer">NAVEGAR NO WAZE</a>
        <a className="btn big" href={googleMapsLink(cur)} target="_blank" rel="noopener noreferrer">Abrir no Google Maps</a>
        <div className="muted small center">{waze.hint} · {geoText(cur.geo)}</div>

        <div className="actions">
          <button className="btn ok big nav-big" disabled={doneHere} onClick={onDelivered}>✔ ENTREGA CONCLUÍDA{selected.length ? ` (${selected.length})` : ''}</button>
          <button className="btn danger" disabled={doneHere} onClick={() => setFailOpen(true)}>✖ Não entregue{selected.length ? ` (${selected.length})` : ''}</button>
          <button className="btn" disabled={doneHere} onClick={onSkip}>Pular parada</button>
          <button className="btn wide" disabled={pos <= 1} onClick={() => { store.setCursor(session.plan.order[pos - 2]); window.scrollTo({ top: 0 }); }}>← Voltar à parada anterior</button>
        </div>
        <button className="link" onClick={() => setEditing(cur.id)}>Corrigir endereço / tipo de imóvel / fixar localização</button>
      </div>

      {upcoming.length ? (
        <div className="stack">
          <h3>Próximas</h3>
          {upcoming.map((id) => {
            const st = session.stops[id];
            const g = groupOfStop(session, id);
            return (
              <button key={id} className="next-row" onClick={() => store.setCursor(id)} style={{ borderLeftColor: g ? colorOf(g.colorKey).bg : '#ccc' }}>
                <Chips packages={st.packages} onlyPending />
                <span className="small">{formatAddress(effectiveAddress(st), false)}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      <UndoList stops={lastDone} />
      {recent.length ? <div className="muted small">Último registro: {recent[0].justification}</div> : null}

      <Modal open={failOpen} title="Não entregue" onClose={() => setFailOpen(false)}>
        <div className="stack">
          {FAIL_REASONS.map((r) => <button key={r} className={`btn ${failReason === r ? 'primary' : ''}`} onClick={() => setFailReason(r)}>{r}</button>)}
          <input value={failReason} onChange={(e) => setFailReason(e.target.value)} placeholder="Outro motivo" />
          <button className="btn danger big" disabled={!failReason.trim()} onClick={onFailed}>Registrar não entrega</button>
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
                    Ir para {useStore.getState().session!.stops[id].packages.filter((p) => p.status === 'pending').map((p) => shortLabel(p)).join(' ')}
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
