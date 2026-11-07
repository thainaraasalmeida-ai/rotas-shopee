import { addressKey, DEFAULT_REGION, inferPropertyType, splitStreetNumber, stripAccents } from '../domain/address';
import { parseLabelTokens, tokensToPackages } from '../domain/packages';
import type { ImportResult, Package, Stop } from '../domain/types';
import { validateImport } from './validate';

export type Field =
  | 'label' | 'tracking' | 'address' | 'number' | 'complement' | 'district'
  | 'city' | 'zip' | 'notes' | 'lat' | 'lng' | 'qty';

export const FIELD_LABEL: Record<Field, string> = {
  label: 'Nº do pacote / sequência',
  tracking: 'Código de rastreio',
  address: 'Endereço',
  number: 'Número',
  complement: 'Complemento',
  district: 'Bairro',
  city: 'Cidade',
  zip: 'CEP',
  notes: 'Observação',
  lat: 'Latitude',
  lng: 'Longitude',
  qty: 'Quantidade',
};

// Sinônimos usados nas exportações da Shopee/SPX (pt/en) e planilhas comuns.
const SYNONYMS: Record<Field, string[]> = {
  label: ['sequence', 'sequencia', 'seq', 'ordem', 'n pacote', 'numero do pacote', 'etiqueta', 'parada', 'stop', 'pacote', 'package no', 'spx seq'],
  tracking: ['tracking', 'tracking number', 'spx tn', 'tn', 'codigo de rastreio', 'rastreio', 'at id', 'order id', 'pedido', 'awb', 'id do pacote', 'shipment id'],
  address: ['destination address', 'endereco', 'address', 'logradouro', 'rua', 'endereco de entrega', 'endereco completo', 'delivery address'],
  number: ['numero', 'number', 'nro', 'n'],
  complement: ['complemento', 'complement', 'address line 2', 'apto'],
  district: ['bairro', 'neighborhood', 'district', 'neighbourhood'],
  city: ['cidade', 'city', 'municipio'],
  zip: ['cep', 'zipcode', 'zip code', 'zip', 'postal code', 'postcode'],
  notes: ['observacao', 'observacoes', 'obs', 'remark', 'remarks', 'nota', 'notes', 'instrucoes', 'referencia', 'ponto de referencia'],
  lat: ['latitude', 'lat'],
  lng: ['longitude', 'lng', 'lon', 'long'],
  qty: ['quantidade', 'qtd', 'qty', 'quantity', 'volumes'],
};

const norm = (s: unknown) => stripAccents(String(s ?? '')).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export type Mapping = Partial<Record<Field, number>>;

export function detectHeader(rows: unknown[][]): { headerRow: number; mapping: Mapping } {
  let best = { headerRow: 0, mapping: {} as Mapping, score: -1 };
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const mapping: Mapping = {};
    const cells = rows[r].map(norm);
    // 1º: correspondência exata; 2º: contém
    for (const pass of ['exact', 'contains'] as const) {
      (Object.keys(SYNONYMS) as Field[]).forEach((f) => {
        if (mapping[f] !== undefined) return;
        const idx = cells.findIndex(
          (c, i) => c && !Object.values(mapping).includes(i) &&
            SYNONYMS[f].some((syn) => (pass === 'exact' ? c === syn : syn.length > 3 && c.includes(syn))),
        );
        if (idx >= 0) mapping[f] = idx;
      });
    }
    const score = Object.keys(mapping).length + (mapping.address !== undefined ? 3 : 0);
    if (score > best.score) best = { headerRow: r, mapping, score };
  }
  return { headerRow: best.headerRow, mapping: best.mapping };
}

function cell(row: unknown[], idx: number | undefined): string {
  if (idx === undefined) return '';
  const v = row[idx];
  return v === null || v === undefined ? '' : String(v).trim();
}

/** Remove bairro/cidade/UF/CEP do fim de um endereço completo e devolve o restante como complemento. */
function parseFullAddress(full: string): { street: string; number: string; complement: string; zip?: string } {
  const zip = full.match(/\b\d{5}-?\d{3}\b/)?.[0];
  const parts = full.replace(/\b\d{5}-?\d{3}\b/, '').split(/\s*[,;]\s*|\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  const { street, number } = splitStreetNumber(parts.slice(0, 2).join(', '));
  const rest = parts.slice(number ? 2 : 1).filter((p) => {
    const n = norm(p);
    return n && !['bom retiro', 'ipatinga', 'mg', 'minas gerais', 'brasil', 'brazil'].includes(n);
  });
  return { street, number, complement: rest.join(', '), zip };
}

export function parseSheetRows(rows: unknown[][], fileName: string, override?: { headerRow: number; mapping: Mapping }): ImportResult & { headerRow: number; mapping: Mapping; headers: string[] } {
  const { headerRow, mapping } = override ?? detectHeader(rows);
  const headers = (rows[headerRow] ?? []).map((h) => String(h ?? ''));
  const byKey = new Map<string, Stop>();
  const stops: Stop[] = [];
  const issues: ImportResult['issues'] = [];

  if (mapping.address === undefined) {
    issues.push({ level: 'erro', message: 'Não encontrei a coluna de endereço. Ajuste o mapeamento das colunas.' });
  }

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => String(c ?? '').trim() === '')) continue;
    const addrCell = cell(row, mapping.address);
    if (!addrCell) continue;

    let street: string, number: string, compFromAddr = '', zip = cell(row, mapping.zip) || undefined;
    if (mapping.number !== undefined && cell(row, mapping.number)) {
      street = addrCell.replace(/,\s*$/, '');
      number = cell(row, mapping.number);
    } else {
      const p = parseFullAddress(addrCell);
      street = p.street; number = p.number; compFromAddr = p.complement; zip = zip ?? p.zip;
    }
    const complement = [cell(row, mapping.complement), compFromAddr].filter(Boolean).join(' · ');
    const notes = cell(row, mapping.notes);
    const address = {
      street, number,
      district: cell(row, mapping.district) || DEFAULT_REGION.district,
      city: cell(row, mapping.city) || DEFAULT_REGION.city,
      state: DEFAULT_REGION.state,
      zip,
      raw: addrCell,
    };
    const key = addressKey(address);
    let stop = byKey.get(key);
    if (!stop) {
      const id = `p${stops.length + 1}`;
      stop = {
        id, original: address, complement: '', notes: '', propertyType: 'desconhecido', propertyTypeSource: 'nenhum',
        packages: [], flags: [],
      };
      byKey.set(key, stop);
      stops.push(stop);
    }
    // Pacotes desta linha
    const labelCell = cell(row, mapping.label);
    const tracking = cell(row, mapping.tracking);
    // Números soltos ("105 +1") viram "#105 +1"; o "+1" continua sendo pacote adicional sem número.
    const asTokens = /^[\s#+\d,;]+$/.test(labelCell) ? labelCell.replace(/(^|[\s,;])(\d{1,5})(?=$|[\s,;])/g, '$1#$2') : '';
    const tokens = parseLabelTokens(asTokens);
    let pkgs: Package[];
    if (tokens.length) pkgs = tokensToPackages(tokens, `${stop.id}-r${r}`);
    else pkgs = [{ id: `${stop.id}-r${r}`, label: tracking || labelCell || `Linha ${r + 1}`, number: null, extra: false, status: 'pending' }];
    pkgs.forEach((p) => { p.tracking = tracking || undefined; p.complement = complement || undefined; });

    const qty = parseInt(cell(row, mapping.qty), 10);
    if (qty > pkgs.length) {
      const extra = tokensToPackages([{ kind: 'extra', value: qty - pkgs.length }], `${stop.id}-r${r}q`);
      pkgs.push(...extra);
      issues.push({ level: 'info', message: `Linha ${r + 1}: quantidade ${qty} — ${extra.length} pacote(s) adicional(is) sem número (+${extra.length}).` });
    }
    stop.packages.push(...pkgs);
    if (complement && !stop.complement.split(' · ').includes(complement)) stop.complement = [stop.complement, complement].filter(Boolean).join(' · ');
    if (notes && !stop.notes.includes(notes)) stop.notes = [stop.notes, notes].filter(Boolean).join(' · ');

    const lat = parseFloat(cell(row, mapping.lat).replace(',', '.'));
    const lng = parseFloat(cell(row, mapping.lng).replace(',', '.'));
    if (!stop.geo && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) > 0.1) {
      stop.geo = { lat, lng, precision: 'shopee', verified: false, source: 'Planilha Shopee' };
    }
  }
  for (const s of stops) {
    s.propertyType = inferPropertyType(`${s.complement} ${s.notes}`);
    s.propertyTypeSource = s.propertyType === 'desconhecido' ? 'nenhum' : 'inferido';
  }
  const result: ImportResult = { source: 'planilha', fileName, stops, groups: [], issues };
  result.issues = [...issues, ...validateImport(result)];
  return { ...result, headerRow, mapping, headers };
}

export async function readSheetFile(data: ArrayBuffer): Promise<unknown[][]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(data, { type: 'array' });
  // Usa a aba com mais linhas
  let best: unknown[][] = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: false, defval: '' });
    if (rows.length > best.length) best = rows;
  }
  return best;
}
