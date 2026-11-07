import { useState } from 'react';
import { effectiveAddress, formatAddress, PROPERTY_LABEL } from '../../domain/address';
import type { GeoPoint, PropertyType, Stop } from '../../domain/types';
import { useStore } from '../../store/store';
import { Chips, Modal } from './common';
import { MapView } from './MapView';

const PRECISION_LABEL: Record<GeoPoint['precision'], string> = {
  shopee: 'coordenada da Shopee',
  numero: 'número encontrado no mapa',
  rua: 'só a rua (número não encontrado)',
  aproximado: 'aproximada',
  manual: 'marcada no mapa por você',
  gps: 'GPS na porta',
};

export function geoText(g?: GeoPoint) {
  if (!g) return 'Sem localização';
  return `${g.verified ? '✔ Conferida' : 'Não conferida'} · ${PRECISION_LABEL[g.precision]}`;
}

export function StopEditor({ stopId, onClose }: { stopId: string; onClose: () => void }) {
  const stop = useStore((s) => s.session?.stops[stopId]);
  if (!stop) return null;
  return <Editor stop={stop} onClose={onClose} />;
}

function Editor({ stop, onClose }: { stop: Stop; onClose: () => void }) {
  const { correctAddress, confirmPropertyType, setGeo, setSpecial } = useStore();
  const special = useStore((s) => !!s.session?.specials?.[stop.id]);
  const cur = effectiveAddress(stop);
  const [street, setStreet] = useState(cur.street);
  const [number, setNumber] = useState(cur.number);
  const [note, setNote] = useState(stop.correctionNote ?? '');
  const [msg, setMsg] = useState('');
  const [pickOnMap, setPickOnMap] = useState(false);

  const saveCorrection = () => {
    if (!street.trim()) return;
    if (street.trim() === stop.original.street && number.trim() === stop.original.number) {
      correctAddress(stop.id, undefined);
      setMsg('Mantido o endereço original da Shopee.');
      return;
    }
    correctAddress(stop.id, { ...stop.original, street: street.trim(), number: number.trim(), raw: `${street.trim()}, ${number.trim()}` }, note.trim() || undefined);
    setMsg('Correção salva. A localização será refeita e a rota marcada para recalcular (o original foi preservado).');
  };

  const useGps = () => {
    setMsg('Obtendo GPS…');
    if (!('geolocation' in navigator)) return setMsg('GPS indisponível neste navegador.');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setGeo(stop.id, { lat: p.coords.latitude, lng: p.coords.longitude, precision: 'gps', verified: true, source: `GPS (±${Math.round(p.coords.accuracy)} m)` });
        setMsg(`Localização fixada pelo GPS (precisão ±${Math.round(p.coords.accuracy)} m). Será reutilizada nas próximas rotas para este endereço.`);
      },
      (e) => setMsg(`Não foi possível obter o GPS: ${e.message}. Abra o app pelo endereço publicado (https) e permita a localização.`),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  return (
    <Modal open title="Endereço e localização" onClose={onClose}>
      <div className="stack">
        <Chips packages={stop.packages} />
        <div className="box">
          <div className="lbl">Endereço original (Shopee) — preservado</div>
          <div>{formatAddress(stop.original)}</div>
          {stop.complement ? <div className="muted">Compl.: {stop.complement}</div> : null}
        </div>
        {stop.flags.map((f) => <div key={f} className="warn">{f}</div>)}

        <div className="lbl">Correção manual</div>
        <input value={street} onChange={(e) => setStreet(e.target.value)} placeholder="Rua" />
        <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Número" inputMode="numeric" />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Motivo (ex.: etiqueta diz Tomás Gonzaga)" />
        <div className="row">
          <button className="btn primary" onClick={saveCorrection}>Salvar correção</button>
          {stop.corrected ? <button className="btn" onClick={() => { correctAddress(stop.id, undefined); setStreet(stop.original.street); setNumber(stop.original.number); setMsg('Voltou ao endereço original.'); }}>Usar original</button> : null}
        </div>

        <div className="lbl">Ponto de coleta</div>
        <div className="row wrap">
          {special ? (
            <button className="btn" onClick={() => setSpecial(stop.id, false)}>Não é ponto de coleta</button>
          ) : (
            <button className="btn" onClick={() => setSpecial(stop.id, true)}>Marcar como ponto de coleta (grupo exclusivo)</button>
          )}
        </div>

        <div className="lbl">Tipo de imóvel {stop.propertyTypeSource === 'confirmado' ? '(confirmado)' : stop.propertyTypeSource === 'inferido' ? '(inferido do texto — confirme)' : ''}</div>
        <div className="row wrap">
          {(['casa', 'predio', 'comercio'] as PropertyType[]).map((t) => (
            <button key={t} className={`btn ${stop.propertyType === t && stop.propertyTypeSource === 'confirmado' ? 'primary' : ''}`} onClick={() => confirmPropertyType(stop.id, t)}>
              {PROPERTY_LABEL[t]}
            </button>
          ))}
        </div>

        <div className="lbl">Localização: {geoText(stop.geo)}</div>
        <div className="row wrap">
          <button className="btn" onClick={useGps}>📍 Estou na porta: usar GPS</button>
          <button className="btn" onClick={() => setPickOnMap((v) => !v)}>{pickOnMap ? 'Fechar mapa' : 'Marcar no mapa'}</button>
          {stop.geo ? <button className="btn" onClick={() => setGeo(stop.id, undefined)}>Limpar</button> : null}
        </div>
        {pickOnMap ? (
          <>
            <div className="muted">Toque no mapa sobre o imóvel.</div>
            <MapView
              height={260}
              focus={stop.geo ? [stop.geo.lat, stop.geo.lng] : undefined}
              markers={stop.geo ? [{ id: stop.id, lat: stop.geo.lat, lng: stop.geo.lng, color: '#e11', text: '●' }] : []}
              onMapClick={(lat, lng) => { setGeo(stop.id, { lat, lng, precision: 'manual', verified: true, source: 'Marcado no mapa' }); setMsg('Posição marcada e conferida.'); }}
            />
          </>
        ) : null}
        {msg ? <div className="info">{msg}</div> : null}
      </div>
    </Modal>
  );
}
