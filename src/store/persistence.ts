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
      return localStorage.getItem(name) ?? memory.get(name) ?? null;
    } catch {
      return memory.get(name) ?? null;
    }
  },
  setItem(name, value) {
    memory.set(name, value);
    try {
      localStorage.setItem(name, value);
    } catch {
      /* armazenamento indisponível ou cheio: mantém em memória */
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
