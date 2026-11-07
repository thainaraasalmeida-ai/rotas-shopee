import { splitStreetNumber, inferPropertyType, DEFAULT_REGION } from '../domain/address';
import { parseLabelTokens, tokensToPackages } from '../domain/packages';
import type { Group, ImportResult, Stop } from '../domain/types';
import { groupColorKey } from '../domain/colors';
import { validateImport } from './validate';

export interface TextItem {
  str: string;
  x: number;
  y: number;
  page: number;
}

/** Reagrupa os fragmentos de texto do PDF em linhas visuais (mesma página e mesma altura). */
export function itemsToLines(items: TextItem[], tolerance = 2.5): string[] {
  const sorted = [...items].filter((i) => i.str.trim() !== '').sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const lines: { page: number; y: number; parts: TextItem[] }[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= tolerance) last.parts.push(it);
    else lines.push({ page: it.page, y: it.y, parts: [it] });
  }
  return lines.map((l) =>
    l.parts
      .sort((a, b) => a.x - b.x)
      .map((p) => p.str.trim())
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

const STREET_START = /^(\d{1,3})\s+((?:Rua|R\.|Avenida|Av\.?|Travessa|Tv\.?|Alameda|Al\.|Pra[çc]a|Estrada|Rodovia|Beco|Largo)\s.+)$/i;
const GROUP_HEADER = /^GRUPO\s+(\d+)\s*(.*?)\s+(\d+)\s+pacotes?\s*[·•\-|]\s*(\d+)\s+paradas?/i;
const DOC_HEADER = /(\d+)\s+pacotes?\s*[·•\-|]\s*(\d+)\s+paradas?/i;
const LABEL_STRIP = /#\s?\d{1,5}|(?:^|\s)\+\s?\d{1,2}(?=$|\s)/g;
const COMPLEMENT_LIKE = /^(ap|apt|apto|apartamento|casa|bloco|bl|sala|loja|fundos|cobertura|\d{1,4}\b|[A-Z]$)/i;

/** Interpreta as linhas de um PDF de rota organizada (formato "GRUPO N ... / parada / #etiquetas"). */
export function parseRouteLines(lines: string[], fileName = 'rota.pdf'): ImportResult {
  const stops: Stop[] = [];
  const groups: Group[] = [];
  const declaredGroups = new Map<number, { packages: number; stops: number }>();
  let declared: ImportResult['declared'];
  let title: string | undefined;
  let current: Stop | null = null;
  let currentGroup: Group | null = null;
  let subLines: string[] = [];
  const allTokens = new Map<string, ReturnType<typeof parseLabelTokens>>();
  const declaredQtys = new Map<string, number>();

  const flushSub = () => {
    if (!current) return;
    const comp: string[] = [];
    const notes: string[] = [];
    subLines.forEach((s, i) => (i === 0 && COMPLEMENT_LIKE.test(s) ? comp : notes).push(s));
    current.complement = comp.join(' · ');
    current.notes = notes.join(' · ');
    current.propertyType = inferPropertyType(`${current.complement} ${current.notes}`);
    current.propertyTypeSource = current.propertyType === 'desconhecido' ? 'nenhum' : 'inferido';
    subLines = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!title && /^rota\b/i.test(line)) title = line;

    const gh = line.match(GROUP_HEADER);
    if (gh) {
      flushSub();
      current = null;
      const idx = parseInt(gh[1], 10);
      currentGroup = { index: idx, colorKey: groupColorKey(idx), name: gh[2].trim() || undefined, stopIds: [] };
      groups.push(currentGroup);
      declaredGroups.set(idx, { packages: parseInt(gh[3], 10), stops: parseInt(gh[4], 10) });
      continue;
    }
    if (!declared && !currentGroup) {
      const dh = line.match(DOC_HEADER);
      if (dh) {
        declared = { packages: parseInt(dh[1], 10), stops: parseInt(dh[2], 10) };
        continue;
      }
    }
    if (/^abrir no maps/i.test(line) || /^confer[eê]ncia:/i.test(line)) continue;

    const tokens = parseLabelTokens(line);
    const text = line.replace(LABEL_STRIP, ' ').replace(/\s+/g, ' ').trim();
    const sm = text.match(STREET_START);
    if (sm) {
      flushSub();
      const seq = parseInt(sm[1], 10);
      // Quantidade declarada no fim da linha (PDF do Thiago: "... #28 #29 +1   3").
      let body = sm[2];
      let declaredQty: number | undefined;
      const qm = body.match(/^(.*?,\s*\d+[A-Za-z]?)\s+(\d{1,3})$/);
      if (qm) { body = qm[1]; declaredQty = parseInt(qm[2], 10); }
      const { street, number } = splitStreetNumber(body);
      const id = `s${seq}-${stops.length}`;
      const pkgs = tokensToPackages(tokens, id);
      allTokens.set(id, [...tokens]);
      if (declaredQty !== undefined) declaredQtys.set(id, declaredQty);
      current = {
        id,
        original: { street, number, raw: sm[2], ...DEFAULT_REGION },
        complement: '',
        notes: '',
        propertyType: 'desconhecido',
        propertyTypeSource: 'nenhum',
        packages: pkgs,
        importedGroup: currentGroup?.index,
        importedSeq: seq,
        flags: [],
      };
      stops.push(current);
      currentGroup?.stopIds.push(id);
      continue;
    }
    if (current) {
      if (tokens.length) allTokens.get(current.id)?.push(...tokens);
      if (tokens.length) current.packages.push(...tokensToPackages(tokens, `${current.id}-c${current.packages.length}`));
      if (text) subLines.push(text);
    }
  }
  flushSub();

  // "+2" pode ser ETIQUETA de um pacote sem número (rotas que numeram +1…+4) ou 2 pacotes adicionais.
  // Quando o arquivo declara a quantidade da parada, ela decide. Sem quantidade, "+N" = N pacotes.
  for (const st of stops) {
    const q = declaredQtys.get(st.id);
    const toks = allTokens.get(st.id) ?? [];
    const nNum = toks.filter((t) => t.kind === 'number').length;
    const nExtra = toks.filter((t) => t.kind === 'extra').length;
    if (q !== undefined && nExtra && st.packages.length !== q && nNum + nExtra === q) {
      st.packages = toks.map((t, i) => t.kind === 'number'
        ? { id: `${st.id}-n${t.value}`, label: `#${t.value}`, number: t.value, extra: false, status: 'pending' as const }
        : { id: `${st.id}-x${i}`, label: `+${t.value}`, number: null, extra: true, status: 'pending' as const });
    }
    if (q !== undefined && st.packages.length !== q) {
      st.flags.push(`O arquivo informa ${q} pacote(s) nesta parada, mas foram lidas ${st.packages.length} etiqueta(s).`);
    }
  }

  const result: ImportResult = { source: 'pdf', fileName, title, stops, groups, issues: [], declared };
  result.issues = validateImport(result, declaredGroups);
  return result;
}
