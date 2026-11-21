import { normalizeStreet } from '../domain/address';
import type { Stop } from '../domain/types';

/** Cruza a planilha inteira antes de disponibilizar qualquer mudança na rota do PDF. */
export function combineTracking(existing: Stop[], sheet: Stop[]): Stop[] {
  const usedStops = new Set<string>();
  const usedCodes = new Set<string>();
  const failure = 'Os arquivos divergem em endereço, etiquetas ou quantidade. A rota foi mantida.';
  if (existing.length && existing.every(st => st.packages.every(p => p.trackingSuffix))) {
    const manifest = sheet.flatMap(st => st.packages.map(pkg => ({st,pkg})));
    const linked = existing.map(st => {
      const matches = st.packages.map(p => {
        const candidates = manifest.filter(({pkg}) => pkg.number===p.number && pkg.extra===p.extra && pkg.tracking?.toUpperCase().endsWith(p.trackingSuffix!));
        if (candidates.length!==1) throw new Error(failure);
        const found = candidates[0];
        const code = found.pkg.tracking!;
        if (usedCodes.has(code) || (p.tracking && p.tracking!==code)) throw new Error(failure);
        usedCodes.add(code);
        return found;
      });
      if (!matches.length) throw new Error(failure);
      const dest = matches[0].st;
      const normalize = (s:string) => normalizeStreet(s).replace(/\s+/g,'').replace(/^0+(?=\d)/,'');
      const divergent = matches.some(({st:other}) => other.id!==dest.id) ||
        normalize(st.original.number)!==normalize(dest.original.number) ||
        normalizeStreet(st.original.street).replace(/^(rua|avenida) /,'')!==normalizeStreet(dest.original.street).replace(/^(rua|avenida) /,'');
      return {...st,geo:st.geo ?? (divergent || st.corrected ? undefined : dest.geo),
        flags:divergent ? [...new Set([...st.flags,'O endereço do PDF difere da planilha. Confira a etiqueta antes de navegar.'])] : st.flags,
        packages:st.packages.map((p,i)=>({...p,tracking:matches[i].pkg.tracking,manifestAddress:matches[i].pkg.manifestAddress,complement:matches[i].pkg.complement ?? p.complement}))};
    });
    if (usedCodes.size!==manifest.length) throw new Error(failure);
    return linked;
  }
  const merged = existing.map(stop => {
    const matches = sheet.filter(src => {
      if (usedStops.has(src.id) || !src.original.number || !stop.original.number) return false;
      if (normalizeStreet(src.original.street) !== normalizeStreet(stop.original.street) ||
          normalizeStreet(src.original.number) !== normalizeStreet(stop.original.number)) return false;
      if (stop.original.district && normalizeStreet(stop.original.district) !== normalizeStreet(src.original.district ?? '')) return false;
      return src.packages.length === stop.packages.length &&
        stop.packages.every(p => p.extra || src.packages.some(q => !q.extra && q.number === p.number));
    });
    if (matches.length !== 1) throw new Error(failure);
    const src = matches[0];
    usedStops.add(src.id);
    const packages = stop.packages.map(pkg => {
      const candidates = src.packages.filter(other => pkg.extra ? other.extra : !other.extra && pkg.number === other.number);
      const other = candidates[0];
      const tracking = other?.tracking;
      if (candidates.length !== 1 || !tracking || usedCodes.has(tracking) || (pkg.tracking && pkg.tracking !== tracking)) throw new Error(failure);
      usedCodes.add(tracking);
      return {...pkg,tracking,manifestAddress:other.manifestAddress,complement:other.complement ?? pkg.complement};
    });
    return {...stop,original:{...stop.original,district:src.original.district,zip:src.original.zip},packages,
      geo:stop.geo ?? (stop.corrected ? undefined : src.geo), flags:[...new Set([...stop.flags,...src.flags])]};
  });
  if (usedStops.size !== sheet.length || !usedCodes.size) throw new Error(failure);
  return merged;
}
