import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseSheetRows, readSheetFile } from '../src/importers/spreadsheet';

// Planilha sintética no estilo de exportação SPX (o formato real pode variar — o app permite remapear colunas).
const rows = [
  ['Relatório de rota'],
  ['Sequence', 'SPX TN', 'Destination Address', 'Bairro', 'City', 'Zipcode', 'Remark'],
  ['103', 'BR2611000001', 'Rua Exemplo A, 10', 'Bom Retiro', 'Ipatinga', '35160-000', ''],
  ['104', 'BR2611000002', 'Rua Exemplo A, 10', 'Bom Retiro', 'Ipatinga', '35160-000', ''],
  ['105 +1', 'BR2611000003', 'R. Exemplo A, 10', 'Bom Retiro', 'Ipatinga', '35160-000', ''],
  ['96', 'BR2611000004', 'Rua Exemplo B, 20, Apto 304', 'Bom Retiro', 'Ipatinga', '', 'Portão azul'],
  ['', 'BR2611000005', 'R. Exemplo B, 20', 'Bom Retiro', 'Ipatinga', '', ''],
];

describe('planilha', () => {
  it('agrupa por endereço, conta +1 e preserva complemento', () => {
    const r = parseSheetRows(rows, 't.xlsx');
    expect(r.headerRow).toBe(1);
    expect(r.stops.length).toBe(2);
    const a = r.stops.find((s) => s.original.street.includes('Exemplo A'))!;
    expect(a.packages.length).toBe(4);
    expect(a.packages.map((p) => p.label)).toEqual(['#103', '#104', '#105', '+1']);
    const b = r.stops.find((s) => s.original.street.includes('Exemplo B'))!;
    expect(b.packages.length).toBe(2);
    expect(b.complement).toContain('Apto 304');
    expect(b.notes).toBe('Portão azul');
    expect(b.packages[1].label).toBe('+1'); // sem sequência: pacote adicional sem número (rastreio guardado)
    expect(b.packages[1].tracking).toBe('BR2611000005');
  });
  it('lê xlsx', async () => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Rota');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const read = await readSheetFile(buf);
    expect(parseSheetRows(read, 'x').stops.length).toBe(2);
  });
});

import { cleanStreet } from '../src/importers/spreadsheet';
describe('limpeza de rua', () => {
  it('remove "Fundos" e "Bairro X" do nome da rua', () => {
    expect(cleanStreet('Rua Exemplo Fundos')).toEqual({ street: 'Rua Exemplo', extra: 'Fundos' });
    expect(cleanStreet('R Exemplo Bairro Centro').street).toBe('R Exemplo');
    expect(cleanStreet('Rua Exemplo').street).toBe('Rua Exemplo');
  });
  it('"-" na sequência vira pacote +1 sem número', () => {
    const r = parseSheetRows([
      ['Sequence', 'SPX TN', 'Destination Address'],
      ['1', 'BR1', 'Rua Exemplo, 10'],
      ['-', 'BR2', 'Rua Exemplo, 10'],
    ], 'x');
    expect(r.stops[0].packages.map((p) => p.label)).toEqual(['#1', '+1']);
    expect(r.stops[0].packages[1].tracking).toBe('BR2');
  });
});
