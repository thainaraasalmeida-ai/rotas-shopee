import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../dist/', import.meta.url);
const files = [];
async function collect(folder) {
  const entries = await readdir(new URL(folder, root), { withFileTypes: true });
  for (const entry of entries) {
    const path = join(folder, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) await collect(path + '/');
    else if (path !== 'sw.js') files.push(path);
  }
}
await collect('./');
const version = createHash('sha256');
for (const path of files.sort()) version.update(path).update(await readFile(new URL(path, root)));
const template = await readFile(new URL('./worker.template.js', import.meta.url), 'utf8');
version.update(template);
await writeFile(new URL('sw.js', root), template.replace('__VERSION__', version.digest('hex').slice(0, 16)).replace('"__FILES__"', JSON.stringify(files)));
