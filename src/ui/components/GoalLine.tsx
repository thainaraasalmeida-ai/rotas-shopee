import { useEffect, useState } from 'react';
import { isPending, pendingVisits, useStore, type Session } from '../../store/store';

export const GOAL_MS = 4 * 3600 * 1000;
const DEFAULT_SERVICE_S = 150; // antes de haver ritmo observado: 2,5 min por parada

const hhmm = (t: number) => { const d = new Date(t); return `${d.getHours()}h${String(d.getMinutes()).padStart(2, '0')}`; };
const mins = (ms: number) => { const m = Math.round(Math.abs(ms) / 60000); return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`; };

/**
 * Previsão da última entrega: carro restante (pela sequência calculada) + paradas restantes × ritmo observado.
 * O ritmo por parada desconta o tempo de carro já percorrido, para não contar o deslocamento duas vezes.
 */
export function forecast(s: Session, now = Date.now()) {
  const departedAt = s.shift?.departedAt;
  if (!departedAt) return null;
  const legs = s.plan.legSeconds ?? {};
  const avgLeg = s.plan.totalSeconds && s.plan.order.length ? s.plan.totalSeconds / s.plan.order.length : 60;
  const visits = pendingVisits(s);
  const remainingDrive = visits.reduce((t, id) => t + (legs[id] ?? avgLeg), 0);
  const done = Object.values(s.stops).filter(st => !isPending(st));
  const drivenDone = done.reduce((t, st) => t + (legs[st.id] ?? avgLeg), 0);
  const elapsed = (now - departedAt) / 1000;
  const observed = done.length >= 3 ? Math.max(20, (elapsed - drivenDone) / done.length) : undefined;
  const service = observed ?? DEFAULT_SERVICE_S;
  const end = now + (remainingDrive + visits.length * service) * 1000;
  const target = departedAt + GOAL_MS;
  return { departedAt, target, end, late: end > target, remainingDrive, remainingStops: visits.length, service, observed: observed !== undefined };
}

export function loadingMinutes(s: Session) {
  const a = s.shift?.sortStartedAt, b = s.shift?.loadedAt;
  return a && b && b > a ? Math.round((b - a) / 60000) : undefined;
}

export function GoalLine() {
  const s = useStore(x => x.session)!;
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  const f = forecast(s, now);
  const org = loadingMinutes(s);
  if (!f) return <div className="ss-goal"><span>A meta de 4 horas começa quando você sair.{org ? ` Organização do carro: ${org} min.` : ''}</span><button className="ss-linkbtn" onClick={() => useStore.getState().depart()}>Saí para entregar</button></div>;
  if (!f.remainingStops) return <div className="ss-goal"><b>Rota concluída</b><span>{mins(now - f.departedAt)} desde a saída{org ? ` · organização ${org} min` : ''}</span></div>;
  return (
    <div className={'ss-goal' + (f.late ? ' late' : '')} role={f.late ? 'alert' : undefined}>
      <b>Meta: última entrega até {hhmm(f.target)}</b>
      <span>Previsão {hhmm(f.end)} · {f.late ? `${mins(f.end - f.target)} além da meta` : `folga de ${mins(f.target - f.end)}`}</span>
      <span className="small">{mins(f.remainingDrive * 1000)} de carro + {f.remainingStops} parada{f.remainingStops > 1 ? 's' : ''} × {(f.service / 60).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} min{f.observed ? ' (seu ritmo)' : ' (estimado)'}</span>
    </div>
  );
}
