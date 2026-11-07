import { detectAddressDivergence, formatAddress } from '../domain/address';
import type { ImportIssue, ImportResult } from '../domain/types';

/** Confere totais declarados x encontrados, sequência, duplicidades e "+N". Não altera dados (só marca flags). */
export function validateImport(
  r: ImportResult,
  declaredGroups?: Map<number, { packages: number; stops: number }>,
): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const totalPkgs = r.stops.reduce((s, st) => s + st.packages.length, 0);

  if (r.declared?.stops !== undefined && r.declared.stops !== r.stops.length) {
    issues.push({
      level: 'erro',
      message: `O cabeçalho informa ${r.declared.stops} paradas, mas foram encontradas ${r.stops.length}.`,
    });
  }
  if (r.declared?.packages !== undefined && r.declared.packages !== totalPkgs) {
    issues.push({ level: 'erro', message: `O cabeçalho informa ${r.declared.packages} pacotes, mas foram encontrados ${totalPkgs}.` });
  }

  // Numeração das paradas
  const seqs = r.stops.map((s) => s.importedSeq).filter((n): n is number => n !== undefined);
  if (seqs.length) {
    const max = Math.max(...seqs);
    const set = new Set(seqs);
    const missing: number[] = [];
    for (let i = 1; i <= max; i++) if (!set.has(i)) missing.push(i);
    if (r.declared?.stops !== undefined && max !== r.declared.stops) {
      issues.push({ level: 'erro', message: `A numeração visível das paradas termina em ${max}, mas o cabeçalho informa ${r.declared.stops}.` });
    }
    if (missing.length) issues.push({ level: 'aviso', message: `Paradas ausentes na numeração: ${missing.join(', ')}.` });
    if (set.size !== seqs.length) issues.push({ level: 'aviso', message: 'Há números de parada repetidos.' });
  }

  // Grupos declarados x encontrados
  if (declaredGroups) {
    for (const g of r.groups) {
      const d = declaredGroups.get(g.index);
      if (!d) continue;
      const stops = r.stops.filter((s) => g.stopIds.includes(s.id));
      const pk = stops.reduce((s, st) => s + st.packages.length, 0);
      if (d.stops !== stops.length) issues.push({ level: 'erro', message: `Grupo ${g.index}: informa ${d.stops} paradas, encontradas ${stops.length}.` });
      if (d.packages !== pk) issues.push({ level: 'erro', message: `Grupo ${g.index}: informa ${d.packages} pacotes, encontrados ${pk}.` });
    }
  }

  // Etiquetas
  const nums = r.stops.flatMap((s) => s.packages.filter((p) => p.number !== null).map((p) => p.number as number));
  const seen = new Map<number, number>();
  nums.forEach((n) => seen.set(n, (seen.get(n) ?? 0) + 1));
  const dups = [...seen].filter(([, c]) => c > 1).map(([n]) => `#${n}`);
  if (dups.length) issues.push({ level: 'erro', message: `Etiquetas repetidas: ${dups.join(' ')}.` });
  if (nums.length) {
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const gaps: string[] = [];
    for (let i = min; i <= max; i++) if (!seen.has(i)) gaps.push(`#${i}`);
    if (gaps.length && gaps.length <= 30)
      issues.push({ level: 'info', message: `Números que não aparecem na lista (entre #${min} e #${max}): ${gaps.join(' ')}. Pode ser normal (pacote fora da rota).` });
  }

  const extraStops = r.stops.filter((s) => s.packages.some((p) => p.extra));
  for (const s of extraStops) {
    const n = s.packages.filter((p) => p.extra).length;
    issues.push({
      level: 'info',
      message: `${formatAddress(s.original, false)}: ${n} pacote(s) adicional(is) "+${n}" sem número — contado(s) no total (${s.packages.length} pacotes nesta parada).`,
    });
  }

  const noNumber = r.stops.filter((s) => !s.original.number);
  for (const s of noNumber) issues.push({ level: 'aviso', message: `Endereço sem número: ${s.original.raw}.` });
  const noPkgs = r.stops.filter((s) => s.packages.length === 0);
  for (const s of noPkgs) issues.push({ level: 'erro', message: `Parada sem etiqueta: ${s.original.raw}.` });

  // Divergência citada na observação
  const streets = [...new Set(r.stops.map((s) => s.original.street))];
  for (const s of r.stops) {
    const div = detectAddressDivergence(`${s.notes} ${s.complement}`, s.original.street, streets);
    if (div) {
      const msg = `Possível divergência: ${s.packages.map((p) => p.label).join(' ')} está em ${formatAddress(s.original, false)}, mas a observação cita ${div}. Confira a etiqueta e corrija se necessário.`;
      s.flags.push(msg);
      issues.push({ level: 'aviso', message: msg });
    }
  }
  return issues;
}
