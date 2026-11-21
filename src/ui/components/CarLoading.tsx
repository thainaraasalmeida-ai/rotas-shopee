import { useMemo, useState } from 'react';
import { effectiveAddress } from '../../domain/address';
import { colorOf } from '../../domain/colors';
import { checkIntegrity } from '../../optimize/special';
import { carLoading } from '../../optimize/loading';
import { useStore, type Session } from '../../store/store';
import type { Package } from '../../domain/types';
import '../shosho/shosho.css';

const tag = (p: Package) => (p.extra ? `${p.label}${p.tracking || p.trackingSuffix ? ` …${(p.tracking ?? p.trackingSuffix)!.slice(-5)}` : ''}` : p.label);

/**
 * Carregar o carro, na ordem em que as sacolas entram no porta-malas:
 * primeiro a do fundo (última a ser usada), por último a da abertura (primeira entrega).
 * Dentro de cada sacola: de baixo para cima; o pacote da próxima entrega fica por cima.
 */
export function CarLoading({ session: s }: { session: Session }) {
  const data = useMemo(() => {
    try { return { bags: carLoading(s) }; } catch (e) { return { error: (e as Error).message }; }
  }, [s]);
  const [open, setOpen] = useState<number | null>(null);
  if (!data.bags) return <div className="ss"><p className="ss-warnline">{data.error}</p></div>;
  const bags = data.bags;
  if (!bags.length) return <div className="ss"><p className="ss-check"><span className="ss-ok">Todos os pacotes desta rota já têm uma situação registrada.</span></p></div>;

  const layout = bags.map(b => ({ index: b.group.index, colorKey: b.group.colorKey, stopIds: b.visits.map(v => v.stop.id) }));
  const pendingIds = new Set(layout.flatMap(b => b.stopIds));
  const saved = s.carLoad?.map(b => ({ ...b, stopIds: b.stopIds.filter(id => pendingIds.has(id)) })).filter(b => b.stopIds.length);
  const matches = JSON.stringify(layout) === JSON.stringify(saved);
  const integ = checkIntegrity(s.stops, s.plan.groups);
  const totalPk = bags.reduce((n, b) => n + b.visits.reduce((m, v) => m + v.packages.length, 0), 0);
  const firstBag = bags[bags.length - 1];

  return (
    <div className="ss">
      <div className="ss-check">
        <span className="ss-ok">✔ Sequência pelas ruas (mão única, conversões e travessias){s.plan.totalSeconds ? ` · ~${Math.round(s.plan.totalSeconds / 60)} min ao volante` : ''}</span>
        <span className={integ.ok ? 'ss-ok' : 'ss-no'}>{integ.ok ? `✔ ${totalPk} pacotes pendentes, cada um em uma sacola só` : '✖ Há pacote em duas sacolas ou sem sacola — confira antes de carregar'}</span>
        <span>Primeira entrega: <b>{(() => { const a = effectiveAddress(firstBag.visits[0].stop); return `${a.street}, ${a.number}`; })()}</b> · Sacola {firstBag.group.index} · {colorOf(firstBag.group.colorKey).name}</span>
        {s.carLoad && !matches ? <span className="ss-wa">• A sequência mudou depois do carregamento. Em Entregar continua aparecendo a sacola onde você guardou cada pacote.</span> : null}
      </div>

      <div className="ss-trunk">
        {bags.map((b, i) => {
          const c = colorOf(b.group.colorKey);
          const isBottom = i === 0;
          const isDoor = i === bags.length - 1;
          const count = b.visits.reduce((n, v) => n + v.packages.length, 0);
          const expanded = open === b.group.index || (open === null && isBottom);
          const hoods = [...new Set(b.visits.map(v => effectiveAddress(v.stop).district).filter(Boolean))].join(', ');
          const top = b.visits[0];
          return (
            <section key={b.group.index} className={`ss-load ${isDoor ? 'first' : ''}`} data-step={i + 1} style={{ ['--bc' as string]: c.bg }}>
              <button className="ss-load-h" onClick={() => setOpen(expanded ? -1 : b.group.index)} aria-expanded={expanded}>
                <span className="ss-sw" />
                <span className="ttl">
                  <em>{isBottom ? 'Coloque esta sacola no fundo' : isDoor ? 'Deixe esta perto da abertura · 1ª entrega' : `${i + 1}ª a entrar`}</em>
                  <b>Sacola {b.group.index} · {c.name}{b.group.special ? ' · ponto de coleta' : ''}</b>
                  <span>{count} pacote{count > 1 ? 's' : ''} · {b.visits.length} parada{b.visits.length > 1 ? 's' : ''}{hoods ? ` · ${hoods}` : ''}</span>
                </span>
                <span className="cnt">{expanded ? '▴' : '▾'}</span>
              </button>
              {expanded ? (
                <div className="ss-load-b">
                  <div className="ss-pk-hint" style={{ margin: '0 0 4px' }}>De baixo para cima. Os pacotes de cada parada vão juntos.</div>
                  {[...b.visits].reverse().map((v, j, arr) => {
                    const a = effectiveAddress(v.stop);
                    const isTop = j === arr.length - 1;
                    return (
                      <div key={v.stop.id} className="ss-lrow" style={{ cursor: 'default' }}>
                        <span className="nums">{v.packages.map(tag).join(' ')}</span>
                        <span className="addr">{isTop ? 'por cima · ' : ''}{v.position}ª · {a.street.replace(/^(Rua|Avenida|R\.?|Av\.?) /, '')}, {a.number}</span>
                      </div>
                    );
                  })}
                  <div className="ss-pk-hint" style={{ marginTop: 6 }}>Por cima fica {top.packages.map(tag).join(' ')} — a primeira entrega desta sacola.</div>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="ss-cta">
        <button className="ss-btn go" style={{ width: '100%' }} disabled={matches || !integ.ok} onClick={() => useStore.getState().saveCarLoad(layout)}>
          {matches ? '✓ Carregamento memorizado' : 'Carreguei o carro'}
        </button>
        {matches ? <a className="ss-btn ghost" style={{ marginTop: 8 }} href="#entregar" onClick={() => useStore.getState().setCursor(firstBag.visits[0].stop.id)}>Ir para a primeira entrega</a> : null}
      </div>
    </div>
  );
}
