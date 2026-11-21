import { autoBackupText, backupText } from '../../store/persistence';
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
  pacote: 'Situação física do pacote',
  baixa: 'Registro manual de baixa',
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
  const scheduled = pk.filter(p => p.status === 'rescheduled');
  const closed = pk.filter(pkg => pkg.shopeeClosed);
  const outstanding = closed.filter(pkg => pkg.status !== 'delivered');

  const copy = async () => {
    const data = JSON.stringify({ exportadoEm: new Date().toISOString(), sessao: s }, null, 2);
    try { await navigator.clipboard.writeText(data); setCopied('Dados copiados (JSON).'); } catch { setCopied('O navegador bloqueou a cópia.'); }
  };
  const copySummary = async () => {
    const lines = [
      `${s.title ?? s.fileName}`,
      `Entregues fisicamente: ${delivered.length} · Não entregues: ${failed.length} · Pendentes: ${pending.length} · Com baixa: ${closed.length}`,
      ...outstanding.map(pkg => `Baixa sem entrega física: ${pkg.label} — ${formatAddress(effectiveAddress(pkg.stop), false)}`),
      ...scheduled.map(pkg => `Reagendado: ${pkg.label} · ${pkg.rescheduledFor} · ${formatAddress(effectiveAddress(pkg.stop))}`),
      ...failed.map((p) => `✖ ${p.label} — ${formatAddress(effectiveAddress(p.stop), false)} — ${p.failReason ?? ''}`),
      ...pending.map((p) => `• ${p.label} — ${formatAddress(effectiveAddress(p.stop), false)} (pendente)`),
    ];
    try { await navigator.clipboard.writeText(lines.join('\n')); setCopied('Resumo copiado.'); } catch { setCopied('O navegador bloqueou a cópia.'); }
  };

  return (
    <div className="screen">
      <h2>Resumo da rota</h2>
      <div className="stats">
        <div><big>{delivered.length}</big>entregues fisicamente</div>
        <div><big>{closed.length}</big>com baixa informada</div>
        <div><big>{failed.length}</big>não entregues</div>
        <div><big>{pending.length}</big>pendentes</div>
        <div><big>{scheduled.length}</big>reagendados</div>
        <div><big>{pk.length}</big>total</div>
      </div>
      {outstanding.map(pkg => <div key={pkg.id} className="warn">Baixa sem entrega física · {pkg.label} · {formatAddress(effectiveAddress(pkg.stop), false)}</div>)}
      {scheduled.map(p => <div className="box" key={p.id}>{p.label} · reagendado para {p.rescheduledFor} · {formatAddress(effectiveAddress(p.stop))}
        <button className="btn small" onClick={() => useStore.getState().setPackagesStatus(p.stop.id,'pending',{packageIds:[p.id]})}>Reabrir pacote</button>
      </div>)}
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
      </div>
      <div className="box stack">
        <b>Cópia de segurança</b>
        <span className="muted small">Guarde o arquivo em Arquivos (iPhone) e restaure se trocar de aparelho ou se algo der errado. A ShoSho também mantém uma cópia automática da última gravação.</span>
        <button className="btn" onClick={async () => {
          const text = backupText('rotas-shopee-v1');
          const name = `ShoSho-copia-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
          const file = new File([text], name, { type: 'application/json' });
          try {
            if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'Cópia ShoSho' }); setCopied('Cópia enviada.'); return; }
          } catch { /* cancelado */ }
          const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove();
          setCopied('Cópia de segurança salva: ' + name);
        }}>Salvar cópia de segurança</button>
        <label className="btn">Restaurar de um arquivo<input type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={async e => {
          const f = e.target.files?.[0]; if (!f) return;
          try { const text = await f.text(); if (window.confirm('Substituir a rota atual por esta cópia?')) { useStore.getState().restoreBackup(text); setCopied('Cópia restaurada.'); } }
          catch (err) { setCopied((err as Error).message); }
        }} /></label>
        <button className="btn" onClick={() => {
          const t = autoBackupText(); if (!t) return setCopied('Ainda não há cópia automática.');
          try { if (window.confirm('Voltar para a última gravação automática?')) { useStore.getState().restoreBackup(t); setCopied('Cópia automática restaurada.'); } }
          catch (err) { setCopied((err as Error).message); }
        }}>Restaurar cópia automática</button>
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
