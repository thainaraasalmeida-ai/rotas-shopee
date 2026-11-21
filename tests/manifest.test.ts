import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseSheetRows, readSheetFile } from '../src/importers/spreadsheet';

it.skipIf(!process.env.ROUTE_SHEET_0711)('confere a exportação SPX de 07/11 pelo importador do app', async () => {
  const bytes = Uint8Array.from(readFileSync(process.env.ROUTE_SHEET_0711!));
  const rows = await readSheetFile(bytes.buffer);
  const result = parseSheetRows(rows, '07-11.xlsx');
  const packages = result.stops.flatMap(stop => stop.packages);
  expect(rows.length).toBe(128);
  expect(packages.length).toBe(127);
  expect(new Set(packages.map(pkg => pkg.tracking)).size).toBe(127);
  expect(packages.every(pkg => !!pkg.tracking)).toBe(true);
  expect(packages.filter(pkg => pkg.extra)).toHaveLength(4);
  expect(result.stops).toHaveLength(59);
  expect(result.issues.filter(i => i.level === 'erro')).toHaveLength(0);
  expect(Math.max(...result.stops.map(st => st.packages.length))).toBe(24);
  if (process.env.ROUTE_BACKUP_0711) {
    const backup = readFileSync(process.env.ROUTE_BACKUP_0711, 'utf8');
    for (const card of backup.match(/<li class="stop".*?<\/li>/gs) ?? []) {
      const labels = card.match(/class="lb">([^<]+)/)?.[1].match(/#\d+/g) ?? [];
      const matching = result.stops.filter(st => st.packages.some(p => labels.includes(p.label)));
      if (labels.length) expect(matching).toHaveLength(1);
    }
  }
});
