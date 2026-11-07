import { useEffect, type ReactNode } from 'react';
import { colorOf } from '../../domain/colors';
import { compactLabels } from '../../domain/packages';
import type { Group, Package, RouteMethod } from '../../domain/types';

export function GroupBadge({ group, big, names }: { group?: Group; big?: boolean; names?: Record<number, string> }) {
  if (!group) return <span className="badge badge-none">Sem grupo</span>;
  const c = colorOf(group.colorKey);
  return (
    <span className={`badge ${big ? 'badge-big' : ''}`} style={{ background: c.bg, color: c.fg }}>
      GRUPO {group.index} — {c.name.toUpperCase()}
      {names?.[group.index] ? <small> · {names[group.index]}</small> : null}
    </span>
  );
}

export function Chips({ packages, color, onlyPending, highlight }: { packages: Package[]; color?: string; onlyPending?: boolean; highlight?: string }) {
  const list = onlyPending ? packages.filter((p) => p.status === 'pending') : packages;
  const numbered = list.filter((p) => !p.extra);
  const extras = list.filter((p) => p.extra);
  return (
    <span className="chips">
      {numbered.map((p) => (
        <span key={p.id} className={`chip st-${p.status} ${highlight && p.label === highlight ? 'chip-hl' : ''}`} style={color ? { borderColor: color } : undefined}>
          {p.label}
        </span>
      ))}
      {extras.length ? (
        <span className={`chip chip-extra st-${extras.every((p) => p.status !== 'pending') ? extras[0].status : 'pending'}`} title="Pacote(s) adicional(is) sem número">
          {compactLabels(extras)[0]}
        </span>
      ) : null}
    </span>
  );
}

export const METHOD_INFO: Record<RouteMethod, { label: string; cls: string; text: string }> = {
  importado: { label: 'Ordem do arquivo', cls: 'm-imp', text: 'Grupos e sequência como vieram do arquivo. Ainda não otimizada.' },
  'linha-reta': { label: 'Aproximada (linha reta)', cls: 'm-aprox', text: 'Sem dados de vias: NÃO considera mão única nem conversões.' },
  'malha-viaria': { label: 'Otimizada pela malha viária', cls: 'm-ok', text: 'Tempos de carro reais pelas ruas, respeitando sentido das vias.' },
};

export function MethodBanner({ method, stale }: { method: RouteMethod; stale?: boolean }) {
  const m = METHOD_INFO[method];
  return (
    <div className={`method ${m.cls}`}>
      <b>{m.label}</b> <span>{m.text}</span>
      {stale ? <div className="stale">Endereços foram corrigidos depois do cálculo — recalcule a rota na aba Rota.</div> : null}
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose?: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          {onClose ? <button className="x" onClick={onClose} aria-label="Fechar">×</button> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

export function fmtMin(sec?: number) {
  if (sec === undefined) return '—';
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`;
}
