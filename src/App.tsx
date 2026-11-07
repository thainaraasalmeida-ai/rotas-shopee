import { useEffect, useState } from 'react';
import { useStore } from './store/store';
import { storageAvailable } from './store/persistence';
import { DeliveryScreen } from './ui/screens/DeliveryScreen';
import { ImportScreen } from './ui/screens/ImportScreen';
import { ReportScreen } from './ui/screens/ReportScreen';
import { RouteScreen } from './ui/screens/RouteScreen';
import { SortScreen } from './ui/screens/SortScreen';

type Tab = 'importar' | 'separar' | 'entregar' | 'rota' | 'relatorio';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'importar', label: 'Importar', icon: '⬆' },
  { id: 'separar', label: 'Separar', icon: '▦' },
  { id: 'entregar', label: 'Entregar', icon: '➤' },
  { id: 'rota', label: 'Rota', icon: '⌖' },
  { id: 'relatorio', label: 'Relatório', icon: '☰' },
];

function readHash(): Tab | null {
  const h = location.hash.replace('#', '') as Tab;
  return TABS.some((t) => t.id === h) ? h : null;
}

export default function App() {
  const session = useStore((s) => s.session);
  const [tab, setTab] = useState<Tab>(() => readHash() ?? (session ? 'entregar' : 'importar'));
  const [storageOk] = useState(storageAvailable);

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
        <b>Rotas Shopee</b>
        <span className="muted small">{session ? (session.title ?? session.fileName) : 'Bom Retiro · Ipatinga/MG'}</span>
      </header>
      {!storageOk ? <div className="warn small">Este navegador bloqueou o armazenamento local: o progresso se perde ao fechar a página.</div> : null}
      <main>
        {active === 'importar' && <ImportScreen onDone={() => go('separar')} />}
        {active === 'separar' && session && <SortScreen />}
        {active === 'entregar' && session && <DeliveryScreen />}
        {active === 'rota' && session && <RouteScreen />}
        {active === 'relatorio' && session && <ReportScreen />}
      </main>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={active === t.id ? 'on' : ''} disabled={!session && t.id !== 'importar'} onClick={() => go(t.id)}>
            <span className="ic">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
