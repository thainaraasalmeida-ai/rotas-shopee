import { useMemo, useState } from 'react';
import { effectiveAddress, formatAddress } from '../../domain/address';
import { colorOf } from '../../domain/colors';
import type { Group, Stop } from '../../domain/types';
import { checkIntegrity } from '../../optimize/special';
import { collectionSuggestions, useStore } from '../../store/store';
import { Chips, MethodBanner, Modal } from '../components/common';

/** Separação dos pacotes por grupo (cor + número), pontos de coleta e busca por etiqueta. */
export function SortScreen() {
  const session = useStore((s) => s.session)!;
  const learned = useStore((s) => s.learnedCollectionPoints);
  const threshold = useStore((s) => s.settings.collectionThreshold);
  const { setSpecial, dismissSuggestion } = useStore();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [confirmMark, setConfirmMark] = useState<string | null>(null);

  const index = useMemo(() => {
    const m = new Map<string, { stopId: string; group: number }>();
    for (const g of session.plan.groups) for (const sid of g.stopIds) for (const p of session.stops[sid].packages) {
      if (p.number !== null) m.set(String(p.number), { stopId: sid, group: g.index });
      if (p.tracking) m.set(p.tracking.toUpperCase(), { stopId: sid, group: g.index });
    }
    return m;
  }, [session]);

  const query = q.trim().replace(/^#/, '').toUpperCase();
  const isExtraQuery = /^\+\d*$/.test(q.trim());
  const hits = useMemo(() => {
    if (!query) return [];
    if (isExtraQuery) {
      return session.plan.groups.flatMap((g) => g.stopIds.filter((sid) => session.stops[sid].packages.some((p) => p.extra)).map((sid) => ({ stopId: sid, group: g.index })));
    }
    const exact = index.get(query);
    if (exact) return [exact];
    if (query.length >= 4) return [...index.entries()].filter(([k]) => k.endsWith(query)).slice(0, 5).map(([, v]) => v);
    return [];
  }, [query, index, isExtraQuery, session]);

  const integrity = checkIntegrity(session.stops, session.plan.groups);
  const suggestions = collectionSuggestions(session, learned);
  const regular = session.plan.groups.filter((g) => !g.special);
  const special = session.plan.groups.filter((g) => g.special);

  return (
    <div className="screen">
      <MethodBanner method={session.plan.method} stale={session.plan.stale} />
      <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar pacote: 94, #94 ou +1" inputMode="search" autoComplete="off" />
      {query ? (
        hits.length ? (
          hits.map((h) => {
            const g = session.plan.groups.find((x) => x.index === h.group)!;
            const c = colorOf(g.colorKey);
            const st = session.stops[h.stopId];
            return (
              <div key={h.stopId} className="hit" style={{ background: c.bg, color: c.fg }}>
                <div className="hit-label">{isExtraQuery ? '+N' : `#${query}`}</div>
                <div className="hit-group">GRUPO {g.index} — {c.name.toUpperCase()}{g.special ? ' · PONTO DE COLETA' : ''}</div>
                <div className="hit-addr">{formatAddress(effectiveAddress(st), false)}</div>
                <Chips packages={st.packages} highlight={`#${query}`} />
              </div>
            );
          })
        ) : <div className="warn">Pacote {q} não está nesta rota.</div>
      ) : null}

      <div className={integrity.ok ? 'ok' : 'err'}>
        {integrity.ok
          ? `✔ ${integrity.groupedPackages} pacotes em ${integrity.groups} grupos (${regular.length} comuns + ${special.length} ponto${special.length === 1 ? '' : 's'} de coleta), sem duplicidade nem perda.`
          : `Conferência falhou: ${integrity.groupedPackages} pacotes nos grupos × ${integrity.totalPackages} na rota.${integrity.duplicates.length ? ` ${integrity.duplicates.length} endereço(s) em mais de um grupo.` : ''}${integrity.missing.length ? ` ${integrity.missing.length} endereço(s) sem grupo.` : ''}`}
      </div>

      {suggestions.map((id) => {
        const st = session.stops[id];
        return (
          <div key={id} className="warn">
            <b>Sugestão:</b> {formatAddress(effectiveAddress(st), false)} ({st.packages.length} pacote{st.packages.length === 1 ? '' : 's'}) foi marcado como ponto de coleta em rotas anteriores. Confira se é o mesmo endereço.
            <div className="row wrap" style={{ marginTop: 8 }}>
              <button className="btn small" onClick={() => setSpecial(id, true)}>Confirmar ponto de coleta</button>
              <button className="btn small" onClick={() => dismissSuggestion(id)}>Agora não</button>
            </div>
          </div>
        );
      })}

      {regular.map((g) => {
        const c = colorOf(g.colorKey);
        const stops = g.stopIds.map((id) => session.stops[id]);
        const pk = stops.reduce((s, x) => s + x.packages.length, 0);
        return (
          <section key={g.index} className="group" style={{ borderColor: c.bg }}>
            <button className="group-head" style={{ background: c.bg, color: c.fg }} onClick={() => setOpen(open === g.index ? null : g.index)}>
              <span>GRUPO {g.index} — {c.name.toUpperCase()}</span>
              <small>{g.name && session.plan.method === 'importado' ? g.name + ' · ' : ''}{pk} pacotes · {stops.length} paradas</small>
            </button>
            <div className="group-body">
              {open === g.index
                ? stops.map((st) => (
                    <div key={st.id} className="sortrow">
                      <div className="row between">
                        <span className="muted small">{formatAddress(effectiveAddress(st), false)}</span>
                        <button className="btn small" onClick={() => setConfirmMark(st.id)}>Ponto de coleta</button>
                      </div>
                      <Chips packages={st.packages} />
                    </div>
                  ))
                : <div className="chips-flow">{stops.map((st) => <Chips key={st.id} packages={st.packages} />)}</div>}
            </div>
          </section>
        );
      })}
      {special.map((g) => <SpecialGroupCard key={g.index} group={g} stop={session.stops[g.stopIds[0]]} position={session.plan.order.indexOf(g.stopIds[0]) + 1} total={session.plan.order.length} threshold={threshold} />)}

      <div className="muted small">Toque no grupo para ver os endereços. Em cada endereço, "Ponto de coleta" cria um grupo exclusivo para ele.</div>

      <Modal open={!!confirmMark} title="Criar grupo de ponto de coleta?" onClose={() => setConfirmMark(null)}>
        {confirmMark ? (
          <div className="stack">
            <div><b>{formatAddress(effectiveAddress(session.stops[confirmMark]), false)}</b> · {session.stops[confirmMark].packages.length} pacote(s)</div>
            <Chips packages={session.stops[confirmMark].packages} />
            <p className="small muted">Os pacotes saem do grupo comum e vão para um grupo exclusivo. A ordem de visita na rota não muda. O app vai lembrar deste endereço e sugerir (com confirmação) nas próximas rotas.</p>
            <button className="btn primary big" onClick={() => { setSpecial(confirmMark, true); setConfirmMark(null); }}>Criar grupo exclusivo</button>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function SpecialGroupCard({ group, stop, position, total, threshold }: { group: Group; stop: Stop; position: number; total: number; threshold: number }) {
  const { toggleSeparated, setAllSeparated, setSpecial } = useStore();
  const [undo, setUndo] = useState(false);
  const c = colorOf(group.colorKey);
  const sep = stop.packages.filter((p) => p.separated).length;
  const all = stop.packages.length;
  const done = sep === all;
  return (
    <section className="group special" style={{ borderColor: c.bg }}>
      <div className="group-head" style={{ background: c.bg, color: c.fg }}>
        <span>GRUPO {group.index} — {c.name.toUpperCase()}</span>
        <small>PONTO DE COLETA · {all} pacotes · {group.special === 'auto' ? `automático (≥ ${threshold})` : 'marcado por você'}</small>
      </div>
      <div className="group-body stack">
        <div className="addr" style={{ fontSize: 18 }}>{formatAddress(effectiveAddress(stop), false)}</div>
        {stop.complement || stop.notes ? <div className="muted small">{[stop.complement, stop.notes].filter(Boolean).join(' · ')}</div> : null}
        <div className="muted small">Na rota: parada {position} de {total} (mantida na posição mais eficiente).</div>
        <div className={done ? 'ok' : 'info'}>
          <b>{sep} de {all} separados</b>{done ? ' — conferência completa ✔' : ` — faltam ${all - sep}`}
        </div>
        <div className="sep-grid">
          {stop.packages.map((p) => (
            <button key={p.id} className={`sep ${p.separated ? 'on' : ''} ${p.extra ? 'extra' : ''}`} onClick={() => toggleSeparated(stop.id, p.id)} title={p.tracking}>
              {p.separated ? '✔ ' : ''}{p.extra ? `+1${p.tracking ? ' …' + p.tracking.slice(-5) : ''}` : p.label}
            </button>
          ))}
        </div>
        <div className="row wrap">
          <button className="btn small" onClick={() => setAllSeparated(stop.id, !done)}>{done ? 'Desmarcar todos' : 'Marcar todos como separados'}</button>
          <button className="btn small" onClick={() => setUndo(true)}>Não é ponto de coleta</button>
        </div>
      </div>
      <Modal open={undo} title="Desfazer grupo especial?" onClose={() => setUndo(false)}>
        <p>Os {all} pacotes voltam para o grupo comum do trecho da rota onde este endereço está. Nada é marcado como entregue.</p>
        <div className="row"><button className="btn danger" onClick={() => { setSpecial(stop.id, false); setUndo(false); }}>Desfazer</button><button className="btn" onClick={() => setUndo(false)}>Cancelar</button></div>
      </Modal>
    </section>
  );
}
