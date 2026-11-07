import type { Package } from './types';

export interface LabelToken {
  kind: 'number' | 'extra';
  value: number; // número da etiqueta ou quantidade do "+N"
}

/**
 * Lê rótulos como "#103 #104 #105 +1".
 * "+N" = N pacotes adicionais SEM número. Nunca inventamos números para eles.
 */
export function parseLabelTokens(text: string): LabelToken[] {
  const out: LabelToken[] = [];
  const re = /(#\s?\d{1,5})|((?:^|[\s,;])\+\s?(\d{1,2})(?=$|[\s,;]))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[1]) out.push({ kind: 'number', value: parseInt(m[1].replace(/[#\s]/g, ''), 10) });
    else if (m[3]) out.push({ kind: 'extra', value: parseInt(m[3], 10) });
  }
  return out;
}

export function countPackages(tokens: LabelToken[]): number {
  return tokens.reduce((s, t) => s + (t.kind === 'number' ? 1 : t.value), 0);
}

let seq = 0;
export function newId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

/** Converte tokens em pacotes individuais. "+2" vira 2 pacotes extras, ambos exibidos como parte do "+2". */
export function tokensToPackages(tokens: LabelToken[], stopId: string): Package[] {
  const pkgs: Package[] = [];
  for (const t of tokens) {
    if (t.kind === 'number') {
      pkgs.push({ id: `${stopId}-n${t.value}`, label: `#${t.value}`, number: t.value, extra: false, status: 'pending' });
    } else {
      for (let i = 1; i <= t.value; i++) {
        pkgs.push({
          id: `${stopId}-x${pkgs.length}-${i}`,
          label: t.value === 1 ? '+1' : `+${t.value} (${i}/${t.value})`,
          number: null,
          extra: true,
          status: 'pending',
        });
      }
    }
  }
  return pkgs;
}

/** Rótulos compactos para exibição: "#103 #104 #105 +1". */
export function compactLabels(pkgs: Package[]): string[] {
  const out: string[] = [];
  let extras = 0;
  for (const p of pkgs) {
    if (p.extra) extras++;
    else out.push(p.label);
  }
  if (extras) out.push(`+${extras}`);
  return out;
}

export function pendingCount(pkgs: Package[]): number {
  return pkgs.filter((p) => p.status === 'pending').length;
}
