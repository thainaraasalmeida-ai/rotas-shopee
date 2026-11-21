import { useMemo, useState } from 'react';
import { useStore, type StartPoint } from '../../store/store';
import { MapView, type MapMarker } from './MapView';

const DEFAULT_LOAD_NAME = 'Coelho Diniz · Novo Cruzeiro';
const IPATINGA: [number, number] = [-19.4686, -42.5366];

/** "De onde você vai sair?": GPS confirmado no mapa, ponto de carga salvo ou pino ajustado à mão. */
export function StartPicker({ onConfirmed }: { onConfirmed: () => void }) {
  const loadPoint = useStore(s => s.settings.loadPoint);
  const current = useStore(s => s.session?.start);
  const [cand, setCand] = useState<StartPoint | null>(current ?? null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveAs, setSaveAs] = useState<string | null>(null);

  const useGps = () => {
    setMsg(''); setBusy(true);
    if (!('geolocation' in navigator)) { setBusy(false); setMsg('Este aparelho não liberou o GPS. Escolha seu ponto de carga ou toque no mapa para marcar a saída.'); setCand(c => c ?? null); return; }
    navigator.geolocation.getCurrentPosition(p => {
      setBusy(false);
      const acc = Math.round(p.coords.accuracy);
      setCand({ lat: p.coords.latitude, lng: p.coords.longitude, label: 'Minha localização atual', source: 'gps', accuracy: acc, at: Date.now() });
      if (acc > 60) setMsg(`O GPS está impreciso (±${acc} m). Confira o pino e toque no mapa na saída do estacionamento, se precisar.`);
    }, e => {
      setBusy(false);
      setMsg(`${e.code === 1 ? 'A ShoSho não tem permissão para usar o GPS.' : 'O GPS não respondeu.'} Escolha seu ponto de carga ou toque no mapa para marcar a saída.`);
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  };
  const useLoadPoint = () => { if (loadPoint) { setMsg(''); setCand({ ...loadPoint, source: 'ponto-de-carga', at: Date.now() }); } };
  const moveTo = (lat: number, lng: number) => setCand(c => ({ lat, lng, label: c?.source === 'ponto-de-carga' ? `${c.label} (ajustado)` : 'Ponto marcado no mapa', source: 'ajustado', at: Date.now() }));

  const markers: MapMarker[] = useMemo(() => {
    const m: MapMarker[] = [];
    if (loadPoint && (!cand || cand.source !== 'ponto-de-carga')) m.push({ id: 'carga', lat: loadPoint.lat, lng: loadPoint.lng, color: '#7A4A26', text: 'C', popup: loadPoint.label });
    if (cand) m.push({ id: 'saida', lat: cand.lat, lng: cand.lng, color: '#14934A', text: 'S', popup: 'Saída' });
    return m;
  }, [cand, loadPoint]);

  const confirm = () => {
    if (!cand) return;
    if (saveAs !== null) useStore.getState().saveLoadPoint({ label: saveAs.trim() || DEFAULT_LOAD_NAME, lat: cand.lat, lng: cand.lng });
    const label = saveAs !== null ? (saveAs.trim() || DEFAULT_LOAD_NAME) : cand.label;
    useStore.getState().setStart({ ...cand, label, source: saveAs !== null ? 'ponto-de-carga' : cand.source });
    onConfirmed();
  };

  return (
    <div className="ss-startpick">
      <h2 className="ss-h">De onde você vai sair?</h2>
      <p className="small muted" style={{ margin: 0 }}>O trajeto da saída do estacionamento até a primeira entrega entra no cálculo da rota e das sacolas.</p>
      <button className="ss-btn go" disabled={busy} onClick={useGps}>{busy ? 'Lendo o GPS…' : '📍 Usar minha localização atual'}</button>
      {loadPoint ? <button className="ss-btn ghost" onClick={useLoadPoint}>Meu ponto de carga · {loadPoint.label}</button> : null}
      {msg ? <div className="ss-near-warn" role="alert">{msg}</div> : null}
      {(cand || msg) ? <>
        <MapView markers={markers} onMapClick={moveTo} height={260} focus={cand ? [cand.lat, cand.lng] : loadPoint ? [loadPoint.lat, loadPoint.lng] : IPATINGA} />
        <span className="small muted">Toque no mapa para pôr o pino na saída do estacionamento que você usa.</span>
      </> : null}
      {cand ? <>
        <div className="ss-start-line"><b>Saída:</b> {cand.label}{cand.accuracy ? ` · GPS ±${cand.accuracy} m` : ''}</div>
        {saveAs === null
          ? <button className="ss-linkbtn" onClick={() => setSaveAs(loadPoint?.label ?? DEFAULT_LOAD_NAME)}>{loadPoint ? 'Atualizar “Meu ponto de carga” com este pino' : 'Salvar como “Meu ponto de carga”'}</button>
          : <label className="ss-start-save">Nome do ponto de carga<input value={saveAs} onChange={e => setSaveAs(e.target.value)} /></label>}
        <button className="ss-btn go" onClick={confirm}>Confirmar este ponto de saída</button>
      </> : null}
    </div>
  );
}
