import { useEffect, useRef, useState } from 'react';
import { effectiveAddress, formatAddress } from '../../domain/address';
import type { Stop } from '../../domain/types';
import { Icon } from './Icon';

interface Detector {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}

export function matchTracking(stops: Stop[], code: string) {
  const value = code.trim().toUpperCase();
  if (!value) return [];
  return stops.flatMap(stop => stop.packages.filter(pkg => pkg.tracking?.trim().toUpperCase() === value).map(pkg => ({ stop, pkg })));
}

export function LabelCheck({ current, stops, onMatch, onMismatch }: { current: Stop; stops: Stop[]; onMatch(id: string): void; onMismatch(): void }) {
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [scanning, setScanning] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const check = (input: string) => {
    const matches = matchTracking(stops, input);
    onMismatch();
    if (!matches.length) return setMessage('Código ausente desta rota. Confira o rastreio e o endereço na etiqueta.');
    if (matches.length > 1) return setMessage('Rastreio repetido. Confira as etiquetas individualmente.');
    const { stop, pkg } = matches[0];
    if (stop.id !== current.id) return setMessage('Este pacote pertence a outra parada: ' + formatAddress(effectiveAddress(stop), false));
    if (pkg.status !== 'pending') return setMessage('Este pacote já foi marcado. Confira o relatório.');
    onMatch(pkg.id);
    setMessage('Etiqueta conferida: ' + pkg.label + ' · ' + (pkg.complement || formatAddress(effectiveAddress(stop), false)));
  };
  const latest = useRef(check);
  useEffect(() => { latest.current = check; });
  useEffect(() => {
    if (!scanning) return;
    let cancelled = false;
    let stream: MediaStream | undefined;
    let controls: {stop():void} | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      try {
        const DetectorClass = (window as Window & { BarcodeDetector?: new () => Detector }).BarcodeDetector;
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
        if (cancelled || !video.current) { stream.getTracks().forEach(track => track.stop()); return; }
        if (!DetectorClass) {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          if (cancelled || !video.current) return;
          controls = await new BrowserMultiFormatReader().decodeFromStream(stream,video.current,(result,_error,reader) => {
            if (cancelled || !result) return;
            reader.stop();
            setCode(result.getText()); latest.current(result.getText()); setScanning(false);
          });
          if (cancelled) controls.stop();
          return;
        }
        const detector = new DetectorClass();
        video.current.srcObject = stream;
        await video.current.play();
        const frame = async () => {
          if (cancelled || !video.current) return;
          try {
            const [result] = await detector.detect(video.current);
            if (cancelled) return;
            if (result?.rawValue) { setCode(result.rawValue); latest.current(result.rawValue); setScanning(false); return; }
            timer = setTimeout(frame, 200);
          } catch { if (!cancelled) { setScanning(false); setMessage('Câmera indisponível. Digite o rastreio.'); } }
        };
        await frame();
      } catch {
        if (!cancelled) { setMessage('Leitura pela câmera indisponível. Digite o rastreio ou use um leitor externo.'); setScanning(false); }
      }
    };
    void run();
    return () => { cancelled = true; clearTimeout(timer); controls?.stop(); stream?.getTracks().forEach(track => track.stop()); };
  }, [scanning]);
  if (!stops.some(stop => stop.packages.some(pkg => pkg.tracking))) return <div className="muted small">Arquivo sem rastreios. Confira manualmente a etiqueta e o endereço.</div>;
  return <div className="stack">
    <button className="btn scan-button" onClick={() => setScanning(!scanning)}><Icon name="scan"/>{scanning ? 'Fechar câmera' : 'Ler código com a câmera'}</button>
    {scanning && <video ref={video} muted playsInline style={{ width: '100%' }} />}
    <details className="manual-code"><summary>Digitar código da etiqueta</summary>
    <form className="row wrap" onSubmit={event => { event.preventDefault(); check(code); }}>
      <input aria-label="Código de rastreio" placeholder="Código de rastreio da etiqueta" value={code} onChange={event => setCode(event.target.value)} />
      <button className="btn" disabled={!code.trim()}>Conferir</button>
    </form></details>
    {message && <div role="status" className="info">{message}</div>}
  </div>;
}
