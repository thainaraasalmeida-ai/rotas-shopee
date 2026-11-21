import { DEFAULT_REGION, inferPropertyType } from '../domain/address';
import { groupColorKey } from '../domain/colors';
import type { Group, ImportResult, Stop } from '../domain/types';
import {validateImport} from './validate';

export const blockHeader = /^BLOCO\s+(\d+)\s*[·•]\s*(.+?)\s*[·•]\s*(\d+)\s+pacotes?\b/i;

export function parseBlocks(lines:string[],fileName:string):ImportResult {
  const result:ImportResult = {source:'pdf',fileName,stops:[],groups:[],issues:[]};
  const counts = new Map<number,number>();
  let group:Group | undefined;
  let street = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const header = line.match(blockHeader);
    if (header) {
      const index = Number(header[1]);
      if (counts.has(index)) result.issues.push({level:'erro',message:`Bloco ${index} repetido.`});
      counts.set(index,Number(header[3]));
      group = {index,colorKey:groupColorKey(index),name:header[2],stopIds:[]};
      result.groups.push(group);
      street = '';
      continue;
    }
    if (!group) {
      const title = line.match(/^Rota\b.*?\b(\d+)\s+pacotes?\b/i);
      if (title) { result.title=line; result.declared={packages:Number(title[1])}; }
      continue;
    }
    if (/^(pacotes?|Abrir no Maps|Maps parte \d+)$/i.test(line)) continue;
    const row = line.match(/\bn[º°o]\s*([\d\w /-]+?)\s*(?:→|->)\s*(.+)$/i);
    if (!row) {
      if (/#\d+|→/.test(line)) result.issues.push({level:'erro',message:`Linha de parada ilegível no bloco ${group.index}.`});
      else street=line;
      continue;
    }
    const detail = row[2];
    const tokens = [...detail.matchAll(/(#\s*\d+|sem\s+n[º°o])\s*\(\s*[.…]*\s*([\w]+)\s*\)/gi)];
    if (!street || !tokens.length || tokens.length !== (detail.match(/#\s*\d+|sem\s+n[º°o]/gi)??[]).length) {
      result.issues.push({level:'erro',message:`Endereço ou etiqueta ilegível no bloco ${group.index}, número ${row[1]}.`});
      continue;
    }
    const seq = result.stops.length+1;
    const id = 'b'+group.index+'p'+seq;
    const note = detail.split(/\s+[·•]\s+/).slice(1).join(' · ');
    const clean = street.replace(/\s*\(trecho [^)]+\)\s*$/i,'').trim();
    const st:Stop = {id,original:{...DEFAULT_REGION,raw:street+', '+row[1],street:clean,number:row[1].trim(),district:group.name},
      importedGroup:group.index,importedSeq:seq,complement:'',notes:note,flags:[],propertyType:inferPropertyType(note),
      propertyTypeSource:note?'inferido':'nenhum',packages:tokens.map((match,i) => {
        const number=match[1].startsWith('#') ? Number(match[1].slice(1).trim()) : null;
        return {id:id+'-'+i,label:number===null?'Sem nº':'#'+number,number,extra:number===null,
          trackingSuffix:match[2].toUpperCase(),status:'pending'};
      })};
    group.stopIds.push(id); result.stops.push(st);
  }
  for (const g of result.groups) {
    const count = result.stops.filter(st => st.importedGroup===g.index).reduce((sum,st)=>sum+st.packages.length,0);
    if (count!==counts.get(g.index)) result.issues.push({level:'erro',message:`Bloco ${g.index}: ${count} pacotes lidos de ${counts.get(g.index)}.`});
  }
  result.issues.push(...validateImport(result));
  return result;
}
