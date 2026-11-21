import type { StateStorage } from 'zustand/middleware';

/**
 * Persistência local (localStorage) com proteção contra navegadores que bloqueiam o armazenamento.
 * Para sincronizar com um banco de dados no futuro, troque esta implementação por uma que
 * também envie as alterações a uma API — o restante do app não muda.
 */
const memory = new Map<string, string>();

export const safeStorage: StateStorage = {
  getItem(name) {
    try {
      return memory.get(name) ?? localStorage.getItem(name) ?? null;
    } catch {
      return memory.get(name) ?? null;
    }
  },
  setItem(name, value) {
    memory.set(name, value);
    try {
      localStorage.setItem(name, value);
      // confere a gravação e guarda uma cópia automática da última versão boa
      if (localStorage.getItem(name) !== value) throw new Error('gravação não confere');
      try { localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify({ savedAt: Date.now(), key: name, value })); } catch { /* a cópia é extra */ }
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('shosho-storage-ok'));
    } catch {
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('shosho-storage-error'));
    }
  },
  removeItem(name) {
    memory.delete(name);
    try {
      localStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
};

export function storageAvailable(): boolean {
  try {
    const k = '__t';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export const AUTO_BACKUP_KEY = 'shosho-copia-automatica';

/** Texto da cópia de segurança: o estado salvo inteiro, para guardar em Arquivos e restaurar depois. */
export function backupText(storeKey: string): string {
  const raw = safeStorage.getItem(storeKey) as string | null;
  return JSON.stringify({ app: 'ShoSho', exportedAt: new Date().toISOString(), data: raw ? JSON.parse(raw) : null });
}

/** Lê uma cópia (arquivo exportado ou cópia automática) e devolve o estado salvo. */
export function parseBackup(text: string): { state: Record<string, unknown>; version?: number } {
  const j = JSON.parse(text);
  const data = j?.app === 'ShoSho' ? j.data : j?.value ? JSON.parse(j.value) : j;
  if (!data?.state || !('session' in data.state)) throw new Error('Este arquivo não é uma cópia de segurança da ShoSho.');
  return data;
}

export function autoBackupText(): string | null {
  try { return localStorage.getItem(AUTO_BACKUP_KEY); } catch { return null; }
}
