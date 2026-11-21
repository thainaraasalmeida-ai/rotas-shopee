import { useEffect, useRef, useState } from 'react';
import { effectiveAddress } from '../../domain/address';
import { colorOf } from '../../domain/colors';
import type { Package, Stop } from '../../domain/types';
import { canPrepareBags, groupOfStop, useStore, type Session } from '../../store/store';
import { Icon } from './Icon';

interface Detector { detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>> }

export type ScanResult =
  | { kind: 'ok' | 'repeat'; stop: Stop; pkg: Package; bag: number; colorKey: string; position: number; code: string }
  | { kind: 'foreign' | 'ambiguous'; code: string };

/** Identifica o pacote pelo código de barras completo (inclui extras sem número). Aceita também "#115" digitado. */
export function lookupCode(s: Session, raw: string): ScanResult {
  const code = raw.trim().toUpperCase().replace(/\s+/g, '');
  const all = Object.values(s.stops).flatMap(stop => stop.packages.map(pkg => ({ stop, pkg })));
  let hits = all.filter(({ pkg }) => pkg.tracking?.trim().toUpperCase() === code);
  if (!hits.length && /^#?\d+$/.test(code)) hits = all.filter(({ pkg }) => !pkg.extra && pkg.number === parseInt(code.replace('#', ''), 10));
  // final do rastreio digitado (ex.: 944D) — útil para os extras "+1", "+2"… sem número
  if (!hits.length && code.length >= 4 && !/^#?\d{1,3}$/.test(code)) hits = all.filter(({ pkg }) => pkg.tracking?.trim().toUpperCase().endsWith(code));
  if (!hits.length) return { kind: 'foreign', code };
  if (hits.length > 1) return { kind: 'ambiguous', code };
  const { stop, pkg } = hits[0];
  const rec = s.sorted?.[pkg.id];
  const g = groupOfStop(s, stop.id);
  return { kind: rec ? 'repeat' : 'ok', stop, pkg, bag: rec?.bag ?? g?.index ?? 0, colorKey: rec?.colorKey ?? g?.colorKey ?? 'cinza', position: s.plan.order.indexOf(stop.id) + 1, code };
}

/** Leitura contínua: a câmera fica aberta; cada etiqueta lida registra só a separação. */
export function ScanSort() {
  const session = useStore(x => x.session)!;
  const [scanning, setScanning] = useState(false);
  const [last, setLast] = useState<ScanResult | null>(null);
  const [typed, setTyped] = useState('');
  const [camMsg, setCamMsg] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const recent = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  const handle = (raw: string) => {
    const code = raw.trim().toUpperCase();
    if (!code) return;
    const now = Date.now();
    if (recent.current.code === code && now - recent.current.at < 2500) return; // mesma etiqueta ainda na frente da câmera
    recent.current = { code, at: now };
    const s = useStore.getState().session!;
    const r = lookupCode(s, code);
    if (r.kind === 'ok' && canPrepareBags(s)) useStore.getState().recordSort(r.pkg.id, r.bag, r.colorKey);
    setLast(r);
    try { navigator.vibrate?.(r.kind === 'ok' ? 60 : [80, 60, 80]); } catch { /* sem vibração */ }
  };
  const latest = useRef(handle);
  useEffect(() => { latest.current = handle; });

  useEffect(() => {
    if (!scanning) return;
    let cancelled = false; let stream: MediaStream | undefined; let controls: { stop(): void } | undefined; let timer: ReturnType<typeof setTimeout>;
    (async () => {
      try {
        const D = (window as Window & { BarcodeDetector?: new () => Detector }).BarcodeDetector;
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
        if (cancelled || !video.current) { stream.getTracks().forEach(t => t.stop()); return; }
        if (!D) {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          if (cancelled || !video.current) return;
          controls = await new BrowserMultiFormatReader().decodeFromStream(stream, video.current, result => { if (!cancelled && result) latest.current(result.getText()); });
          if (cancelled) controls.stop();
          return;
        }
        const det = new D(); video.current.srcObject = stream; await video.current.play();
        const frame = async () => {
          if (cancelled || !video.current) return;
          try { const res = await det.detect(video.current); for (const r of res) if (r.rawValue) latest.current(r.rawValue); } catch { /* quadro ruim */ }
          timer = setTimeout(frame, 180);
        };
        await frame();
      } catch { if (!cancelled) { setCamMsg('Câmera indisponível. Digite o código da etiqueta ou use um leitor externo.'); setScanning(false); } }
    })();
    return () => { cancelled = true; clearTimeout(timer); controls?.stop(); stream?.getTracks().forEach(t => t.stop()); };
  }, [scanning]);

  const all = Object.values(session.stops).flatMap(st => st.packages);
  const done = all.filter(p => session.sorted?.[p.id]).length;
  const street = (st: Stop) => { const a = effectiveAddress(st); return `${a.street}${a.number ? ', ' + a.number : ''}`; };

  return (
    <div className="ss ss-scan">
      <div className="ss-topline"><span><b>{done}</b> de {all.length} separados</span><span>{all.length - done} faltam</span></div>
      <div className="ss-prog" style={{ marginBottom: 8 }}><div style={{ width: `${(done / Math.max(1, all.length)) * 100}%` }} /></div>
      {!canPrepareBags(session) ? <div className="ss-warnline">Rota ainda não calculada: a leitura só consulta, não guarda. Calcule a rota em Rota antes de separar.</div> : null}
      <button className="ss-btn go" onClick={() => setScanning(!scanning)}><Icon name="scan" />{scanning ? 'Fechar câmera' : 'Ler etiquetas com a câmera'}</button>
      {scanning ? <video ref={video} muted playsInline className="ss-scan-video" /> : null}
      {camMsg ? <div className="ss-near-warn">{camMsg}</div> : null}
      <form className="ss-scan-form" onSubmit={e => { e.preventDefault(); recent.current = { code: '', at: 0 }; handle(typed); setTyped(''); }}>
        <input aria-label="Código da etiqueta" placeholder="#número, rastreio ou final do rastreio" value={typed} onChange={e => setTyped(e.target.value)} autoCapitalize="characters" autoComplete="off" />
        <button className="ss-btn ghost" disabled={!typed.trim()}>Ler</button>
      </form>

      {last ? (last.kind === 'foreign' || last.kind === 'ambiguous' ? (
        <div className="ss-scan-res bad" role="alert"><b>{last.kind === 'foreign' ? 'Código de outra rota' : 'Código repetido na planilha'}</b><span>{last.code}</span><span>{last.kind === 'foreign' ? 'Este pacote não está na rota de hoje. Separe à parte e confira a etiqueta.' : 'Confira a etiqueta individualmente.'}</span></div>
      ) : ((last: Extract<ScanResult, { kind: 'ok' | 'repeat' }>) => {
        const c = colorOf(last.colorKey);
        const stopPk = last.stop.packages;
        return (
          <div className={'ss-scan-res ' + last.kind} style={{ ['--bc' as string]: c.bg }} role="status">
            {last.kind === 'repeat' ? <span className="ss-scan-tag">Já lido · não somou de novo</span> : null}
            {!canPrepareBags(session) ? <div className="ss-scan-big"><span>{last.pkg.label}</span><span>→ sacola definida após calcular a rota</span></div> : <div className="ss-scan-big"><span>{last.pkg.extra ? `${last.pkg.label} …${last.pkg.tracking?.slice(-5) ?? ''}` : last.pkg.label}</span><span>→</span><span className="ss-sw" /><span>SACOLA {last.bag} · {c.name.toUpperCase()}</span></div>}
            <div className="ss-scan-mid">{last.position}ª parada · {street(last.stop)}</div>
            {last.kind === 'repeat' ? <div>Este pacote já está na <b>Sacola {last.bag} {c.name}</b>.</div> : null}
            {stopPk.length > 1 ? <div className="ss-scan-vol">{stopPk.map(p => <span key={p.id} className={session.sorted?.[p.id] ? 'ok' : 'no'}>{session.sorted?.[p.id] ? '✓' : '○'} {p.extra ? `${p.label} …${p.tracking?.slice(-5) ?? ''}` : p.label}</span>)}<em>{stopPk.filter(p => !session.sorted?.[p.id]).length ? `Faltam ${stopPk.filter(p => !session.sorted?.[p.id]).length} desta porta` : 'Todos os volumes desta porta guardados'}</em></div> : null}
          </div>
        );
      })(last as Extract<ScanResult, { kind: 'ok' | 'repeat' }>)) : <div className="small muted">Pegue qualquer pacote da pilha. A câmera continua aberta para o próximo. A leitura registra só a sacola onde o pacote foi guardado.</div>}
    </div>
  );
}
