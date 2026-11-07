import { useState } from 'react';
import { effectiveAddress, formatAddress } from '../../domain/address';
import { orderedStops, useStore } from '../../store/store';
import { Modal } from '../components/common';

const KIND: Record<string, string> = {
  'saiu-com-pendencia': 'Saiu da rua com pendência',
  'atravessou-com-pendencia': 'Atravessou a avenida com pendência',
  'nao-entregue': 'Não entregue',
  pulou: 'Pulou',
  correcao: 'Correção de endereço',
};

export function ReportScreen() {
  const { session, clearSession } = useStore();
  const s = session!;
  const [copied, setCopied] = useState('');
  const [confirm, setConfirm] = useState(false);
  const stops = orderedStops(s);
  const pk = stops.flatMap((x) => x.packages.map((p) => ({ ...p, stop: x })));
  const delivered = pk.filter((p) => p.status === 'delivered');
  const failed = pk.filter((p) => p.status === 'failed');
  const pending = pk.filter((p) => p.status === 'pending');

  const copy = async () => {
    const data = JSON.stringify({ exportadoEm: new Date().toISOString(), sessao: s }, null, 2);
    try { await navigator.clipboard.writeText(data); setCopied('Dados copiados (JSON).'); } catch { setCopied('O navegador bloqueou a cópia.'); }
  };
  const copySummary = async () => {
    const lines = [
      `${s.title ?? s.fileName}`,
      `Entregues: ${delivered.length} · Não entregues: ${failed.length} · Pendentes: ${pending.length}`,
      ...failed.map((p) => `✖ ${p.label} — ${formatAddress(effectiveAddress(p.stop), false)} — ${p.failReason ?? ''}`),
      ...pending.map((p) => `• ${p.label} — ${formatAddress(effectiveAddress(p.stop), false)} (pendente)`),
    ];
    try { await navigator.clipboard.writeText(lines.join('\n')); setCopied('Resumo copiado.'); } catch { setCopied('O navegador bloqueou a cópia.'); }
  };

  return (
    <div className="screen">
      <h2>Relatório</h2>
      <div className="stats">
        <div><big>{delivered.length}</big>entregues</div>
        <div><big>{failed.length}</big>não entregues</div>
        <div><big>{pending.length}</big>pendentes</div>
        <div><big>{pk.length}</big>total</div>
      </div>
      {failed.length ? (
        <div className="stack">
          <h3>Não entregues</h3>
          {failed.map((p) => <div key={p.id} className="err small">{p.label} — {formatAddress(effectiveAddress(p.stop), false)} — {p.failReason}</div>)}
        </div>
      ) : null}
      {pending.length && pending.length < pk.length ? (
        <div className="stack">
          <h3>Pendentes</h3>
          {pending.map((p) => <div key={p.id} className="warn small">{p.label} — {formatAddress(effectiveAddress(p.stop), false)}</div>)}
        </div>
      ) : null}
      <div className="stack">
        <h3>Registro de auditoria</h3>
        {s.audit.length ? [...s.audit].reverse().map((a, i) => (
          <div key={i} className="box small">
            <b>{KIND[a.kind]}</b> · {new Date(a.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}<br />
            {s.stops[a.stopId] ? formatAddress(effectiveAddress(s.stops[a.stopId]), false) : ''} — {a.justification}
            {a.pendingStopIds.length ? <div className="muted">Pendências: {a.pendingStopIds.map((id) => s.stops[id]?.packages.map((p) => p.label).join(' ')).join(' · ')}</div> : null}
          </div>
        )) : <div className="muted">Nenhum registro ainda.</div>}
      </div>
      <div className="stack">
        <h3>Importação</h3>
        <div className="muted small">{s.fileName}</div>
        {s.issues.filter((i) => i.level !== 'info').map((i, k) => <div key={k} className={i.level === 'erro' ? 'err small' : 'warn small'}>{i.message}</div>)}
      </div>
      <div className="row wrap">
        <button className="btn" onClick={copySummary}>Copiar resumo</button>
        <button className="btn" onClick={copy}>Copiar dados (JSON)</button>
        <button className="btn danger" onClick={() => setConfirm(true)}>Encerrar rota</button>
      </div>
      {copied ? <div className="info">{copied}</div> : null}
      <Modal open={confirm} title="Encerrar rota?" onClose={() => setConfirm(false)}>
        <p>O progresso desta rota será apagado deste aparelho. As localizações conferidas continuam salvas para as próximas rotas.</p>
        <div className="row"><button className="btn danger" onClick={() => { clearSession(); setConfirm(false); }}>Encerrar</button><button className="btn" onClick={() => setConfirm(false)}>Cancelar</button></div>
      </Modal>
    </div>
  );
}
