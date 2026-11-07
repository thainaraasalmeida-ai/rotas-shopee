import type { Address, PropertyType, Stop } from './types';

export const DEFAULT_REGION = { district: 'Bom Retiro', city: 'Ipatinga', state: 'MG' };

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const STREET_PREFIX: [RegExp, string][] = [
  [/^(r\.?|rua)\s+/i, 'rua '],
  [/^(av\.?|avenida)\s+/i, 'avenida '],
  [/^(tv\.?|travessa)\s+/i, 'travessa '],
  [/^(al\.?|alameda)\s+/i, 'alameda '],
  [/^(pc\.?|pca\.?|praca)\s+/i, 'praca '],
];

/** Nome de rua normalizado para comparar ("R. Tomé de Souza" == "Rua Tome de Souza"). */
export function normalizeStreet(street: string): string {
  let s = stripAccents(street).toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [re, rep] of STREET_PREFIX) s = s.replace(re, rep);
  return s;
}

export function addressKey(a: Address): string {
  return `${normalizeStreet(a.street)}|${a.number.replace(/\D/g, '') || a.number.trim().toLowerCase()}`;
}

export function effectiveAddress(stop: Stop): Address {
  return stop.corrected ?? stop.original;
}

export function formatAddress(a: Address, withCity = true): string {
  const base = a.number ? `${a.street}, ${a.number}` : a.street;
  if (!withCity) return base;
  const parts = [base, a.district || DEFAULT_REGION.district, `${a.city || DEFAULT_REGION.city} - ${a.state || DEFAULT_REGION.state}`];
  return parts.filter(Boolean).join(', ');
}

/** Separa "Rua Tomás Gonzaga, 477" (ou "Rua X 477") em rua + número. */
export function splitStreetNumber(line: string): { street: string; number: string } {
  const clean = line.trim().replace(/\s+/g, ' ');
  let m = clean.match(/^(.*?),\s*(n[º°o.]?\s*)?(\d+[A-Za-z]?|s\/?n)\b(.*)$/i);
  if (m) return { street: m[1].trim(), number: m[3].trim() };
  m = clean.match(/^(.*?\D)\s+(n[º°o.]?\s*)?(\d+[A-Za-z]?)$/i);
  if (m) return { street: m[1].trim(), number: m[3].trim() };
  return { street: clean, number: '' };
}

/** Tipo de imóvel inferido de complemento/observação. Fica como "inferido" até o entregador confirmar.
 * Vale a palavra que aparece primeiro (ex.: "Casa ao lado de um prédio" = casa). */
export function inferPropertyType(text: string): PropertyType {
  const t = ` ${stripAccents(text).toLowerCase()} `;
  const rules: [PropertyType, RegExp][] = [
    ['comercio', /\b(loja|academia|lava ?jato|escola|galpao|brecho|mercado|padaria|farmacia|oficina|empresa|ltda|comercio|restaurante|bar|salao|clinica|igreja|lar|escritorio|mprint|ortopedia|chaveiro|legumes|sacolao|consultorio|concessionaria|distribuicao|distribuidora)\b/],
    ['predio', /\b(ap|apt|apto|apart|aparts|apartamento|predio|edificio|bloco|bl|torre|cobertura)\b|\bap\s?\d/],
    ['casa', /\b(casa|cs)\b/],
  ];
  let best: PropertyType = 'desconhecido';
  let pos = Infinity;
  for (const [type, re] of rules) {
    const m = re.exec(t);
    if (m && m.index < pos) { pos = m.index; best = type; }
  }
  return best;
}

export const PROPERTY_LABEL: Record<PropertyType, string> = {
  casa: 'Casa',
  predio: 'Prédio',
  comercio: 'Comércio',
  desconhecido: 'Não informado',
};

/**
 * Detecta quando a observação menciona OUTRA rua (ex.: "o SPX marcou na Tomás Gonzaga 268").
 * Retorna o endereço citado, para sugerir correção — nunca corrige sozinho.
 */
export function detectAddressDivergence(notes: string, ownStreet: string, knownStreets: string[]): string | null {
  const n = normalizeStreet(notes);
  const own = normalizeStreet(ownStreet).replace(/^(rua|avenida|travessa|alameda|praca) /, '');
  for (const st of knownStreets) {
    const core = normalizeStreet(st).replace(/^(rua|avenida|travessa|alameda|praca) /, '');
    if (!core || core === own || core.length < 5) continue;
    const idx = n.indexOf(core);
    if (idx >= 0) {
      const after = n.slice(idx + core.length).match(/^\s*,?\s*(\d+)/);
      return `${st}${after ? ', ' + after[1] : ''}`;
    }
  }
  return null;
}
