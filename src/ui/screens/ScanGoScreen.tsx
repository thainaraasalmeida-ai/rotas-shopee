import { ScanSort } from '../components/ScanSort';
import { currentStopId, useStore } from '../../store/store';
import '../shosho/shosho.css';

/** Aba "Ler e ir": lê a etiqueta e abre a entrega daquele endereço (sem perder a sequência planejada). */
export function ScanGoScreen({ onGo }: { onGo: () => void }) {
  return (
    <div className="screen ss">
      <h2 className="ss-h">Ler e ir</h2>
      <ScanSort onFound={id => { const st = useStore.getState(); const cur = st.session; if (cur && currentStopId(cur) !== id) st.startDetour(id); onGo(); }} />
    </div>
  );
}
