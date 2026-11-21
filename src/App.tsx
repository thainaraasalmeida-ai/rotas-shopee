import { useEffect, useState } from 'react';
import { useStore } from './store/store';
import './ui/shosho/shosho.css';
import { storageAvailable } from './store/persistence';
import { DeliveryScreen } from './ui/screens/DeliveryScreen';
import { ImportScreen } from './ui/screens/ImportScreen';
import { ReportScreen } from './ui/screens/ReportScreen';
import { NearbyScreen } from './ui/screens/NearbyScreen';
import { RouteScreen } from './ui/screens/RouteScreen';
import { SortScreen } from './ui/screens/SortScreen';
import { Icon, type IconName } from './ui/components/Icon';

type Tab = 'importar' | 'separar' | 'entregar' | 'perto' | 'rota' | 'relatorio';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'importar', label: 'Arquivo', icon: 'file' },
  { id: 'separar', label: 'Carregar', icon: 'bag' },
  { id: 'rota', label: 'Rota', icon: 'map' },
  { id: 'entregar', label: 'Entregar', icon: 'nav' },
  { id: 'perto', label: 'Perto de mim', icon: 'pin' },
  { id: 'relatorio', label: 'Resumo', icon: 'report' },
];

function readHash(): Tab | null {
  const h = location.hash.replace('#', '') as Tab;
  return TABS.some((t) => t.id === h) ? h : null;
}

export default function App() {
  const session = useStore((s) => s.session);
  const [tab, setTab] = useState<Tab>(() => readHash() ?? (session ? 'entregar' : 'importar'));
  const [storageOk,setStorageOk] = useState(storageAvailable);
  useEffect(() => {
    const failed = () => setStorageOk(false);
    const ok = () => setStorageOk(true);
    window.addEventListener('shosho-storage-error',failed);
    window.addEventListener('shosho-storage-ok',ok);
    return () => { window.removeEventListener('shosho-storage-error',failed); window.removeEventListener('shosho-storage-ok',ok); };
  },[]);

  // Rotas salvas antes da versão com pontos de coleta: calcula os grupos especiais sem mexer no progresso.
  useEffect(() => {
    const s = useStore.getState().session;
    if (s && s.specials === undefined) useStore.getState().applyAutoSpecials();
  }, []);

  useEffect(() => {
    const h = () => { const t = readHash(); if (t) setTab(t); };
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  const go = (t: Tab) => {
    setTab(t);
    try { history.replaceState(null, '', `#${t}`); } catch { /* sandbox */ }
    window.scrollTo({ top: 0 });
  };

  const active: Tab = !session && tab !== 'importar' ? 'importar' : tab;

  return (
    <div className="app">
      <header className="top">
        <b className="wordmark"><span className="brand-icon"><Icon name="nav" size={20}/></span>Sho<span>Sho</span></b>
        <span className="city"><Icon name="pin" size={15}/>Ipatinga · MG</span>
      </header>
      {!storageOk ? <div className="ss-save-err" role="alert">⚠ O iPhone não conseguiu salvar a última ação. Não feche a ShoSho: vá em Resumo e salve uma cópia de segurança agora.</div> : null}
      <main>
        {active === 'importar' && <ImportScreen onDone={() => go(useStore.getState().session?.plan.order.length === 1 ? 'separar' : 'rota')} />}
        {active === 'separar' && session && <SortScreen />}
        {active === 'entregar' && session && <DeliveryScreen />}
        {active === 'perto' && session && <NearbyScreen onGo={() => go('entregar')} />}
        {active === 'rota' && session && <RouteScreen />}
        {active === 'relatorio' && session && <ReportScreen />}
      </main>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} aria-current={active === t.id ? 'page' : undefined} className={active === t.id ? 'on' : ''} disabled={!session && t.id !== 'importar'} onClick={() => go(t.id)}>
            <span className="ic"><Icon name={t.icon}/></span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
