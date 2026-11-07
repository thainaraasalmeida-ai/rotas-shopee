import type { TextItem } from './pdfRoute';

// Build "legacy" do pdf.js: funciona em versões mais antigas do Safari/iOS.
export async function extractPdfItems(data: ArrayBuffer): Promise<TextItem[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const items: TextItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    for (const it of tc.items as { str?: string; transform?: number[] }[]) {
      if (!it.str || !it.transform) continue;
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], page: p });
    }
  }
  return items;
}
