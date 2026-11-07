import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  color: string;
  text: string;
  dashed?: boolean;
  popup?: string;
}

const IPATINGA_BOM_RETIRO: [number, number] = [-19.4686, -42.5366];

export function MapView({
  markers, path, divider, onMarkerClick, onMapClick, height = 360, focus,
}: {
  markers: MapMarker[];
  path?: [number, number][];
  divider?: [number, number][][];
  onMarkerClick?: (id: string) => void;
  onMapClick?: (lat: number, lng: number) => void;
  height?: number;
  focus?: [number, number];
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;
  const markerRef = useRef(onMarkerClick);
  markerRef.current = onMarkerClick;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true }).setView(focus ?? IPATINGA_BOM_RETIRO, 16);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => clickRef.current?.(e.latlng.lat, e.latlng.lng));
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => { m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current, lg = layer.current;
    if (!m || !lg) return;
    lg.clearLayers();
    divider?.forEach((line) => L.polyline(line, { color: '#000', weight: 6, opacity: 0.25 }).addTo(lg));
    if (path && path.length > 1) L.polyline(path, { color: '#333', weight: 2, opacity: 0.6, dashArray: '4 6' }).addTo(lg);
    for (const mk of markers) {
      const icon = L.divIcon({
        className: '',
        html: `<div class="mk ${mk.dashed ? 'mk-approx' : ''}" style="background:${mk.color}">${mk.text}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      const marker = L.marker([mk.lat, mk.lng], { icon }).addTo(lg);
      if (mk.popup) marker.bindTooltip(mk.popup, { direction: 'top' });
      marker.on('click', () => markerRef.current?.(mk.id));
    }
    if (focus) m.setView(focus, Math.max(m.getZoom(), 17));
    else if (markers.length) m.fitBounds(L.latLngBounds(markers.map((x) => [x.lat, x.lng] as [number, number])).pad(0.15));
  }, [markers, path, divider, focus]);

  return <div ref={el} className="map" style={{ height }} />;
}
