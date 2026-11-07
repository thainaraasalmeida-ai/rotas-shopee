import { useMemo, useState } from 'react';
import { effectiveAddress, formatAddress } from '../../domain/address';
import { colorOf } from '../../domain/colors';
import { parseLabelTokens } from '../../domain/packages';
import { useStore } from '../../store/store';
import { Chips, MethodBanner } from '../components/common';

/** Separação dos pacotes por grupo (cor + número) e busca por etiqueta. */
export function SortScreen() {
  const session = useStore((s) => s.session)!;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);

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

  const total = Object.values(session.stops).reduce((s, x) => s + x.packages.length, 0);
  const extraNote = parseLabelTokens(q).some((t) => t.kind === 'extra');

  return (
    <div className="screen">
      <MethodBanner method={session.plan.method} stale={session.plan.stale} />
      <input
        className="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar pacote: 94, #94 ou +1"
        inputMode="search"
        autoComplete="off"
      />
      {query ? (
        hits.length ? (
          hits.map((h) => {
            const g = session.plan.groups.find((x) => x.index === h.group)!;
            const c = colorOf(g.colorKey);
            const st = session.stops[h.stopId];
            return (
              <div key={h.stopId} className="hit" style={{ background: c.bg, color: c.fg }}>
                <div className="hit-label">{isExtraQuery || extraNote ? '+N' : `#${query}`}</div>
                <div className="hit-group">GRUPO {g.index} — {c.name.toUpperCase()}</div>
                <div className="hit-addr">{formatAddress(effectiveAddress(st), false)}</div>
                <Chips packages={st.packages} highlight={`#${query}`} />
              </div>
            );
          })
        ) : <div className="warn">Pacote {q} não está nesta rota.</div>
      ) : null}

      <div className="muted">{session.plan.groups.length} grupos · {total} pacotes · {session.plan.order.length} paradas</div>
      {session.plan.groups.map((g) => {
        const c = colorOf(g.colorKey);
        const stops = g.stopIds.map((id) => session.stops[id]);
        const pk = stops.reduce((s, x) => s + x.packages.length, 0);
        return (
          <section key={g.index} className="group" style={{ borderColor: c.bg }}>
            <button className="group-head" style={{ background: c.bg, color: c.fg }} onClick={() => setOpen(open === g.index ? null : g.index)}>
              <span>GRUPO {g.index} — {c.name.toUpperCase()}</span>
              <small>{session.importedGroupNames[g.index] && session.plan.method === 'importado' ? session.importedGroupNames[g.index] + ' · ' : ''}{pk} pacotes · {stops.length} paradas</small>
            </button>
            <div className="group-body">
              {open === g.index
                ? stops.map((st) => (
                    <div key={st.id} className="sortrow">
                      <div className="muted small">{formatAddress(effectiveAddress(st), false)}</div>
                      <Chips packages={st.packages} />
                    </div>
                  ))
                : <div className="chips-flow">{stops.map((st) => <Chips key={st.id} packages={st.packages} />)}</div>}
            </div>
          </section>
        );
      })}
      <div className="muted small">Toque no grupo para ver os endereços de cada etiqueta.</div>
    </div>
  );
}
