import { useState } from 'react';
import type { ImportResult } from '../../domain/types';
import { itemsToLines, parseRouteLines } from '../../importers/pdfRoute';
import { FIELD_LABEL, parseSheetRows, readSheetFile, type Field, type Mapping } from '../../importers/spreadsheet';
import { useStore } from '../../store/store';
import { Modal } from '../components/common';

type SheetState = { rows: unknown[][]; headerRow: number; mapping: Mapping; headers: string[]; fileName: string };

export function ImportScreen({ onDone }: { onDone: () => void }) {
  const { loadImport, session } = useStore();
  const [result, setResult] = useState<ImportResult | null>(null);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirmReplace, setConfirmReplace] = useState(false);

  const onFile = async (f: File) => {
    setError(''); setResult(null); setSheet(null);
    setBusy('Lendo arquivo…');
    try {
      const buf = await f.arrayBuffer();
      if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
        const { extractPdfItems } = await import('../../importers/pdfText');
        const items = await extractPdfItems(buf);
        const r = parseRouteLines(itemsToLines(items), f.name);
        if (!r.stops.length) setError('Não encontrei paradas neste PDF. Ele precisa ter texto (não pode ser foto escaneada).');
        setResult(r);
      } else {
        const rows = await readSheetFile(buf);
        const r = parseSheetRows(rows, f.name);
        setSheet({ rows, headerRow: r.headerRow, mapping: r.mapping, headers: r.headers, fileName: f.name });
        setResult(r);
      }
    } catch (e) {
      setError(`Não consegui ler o arquivo: ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  };

  const remap = (field: Field, idx: number | undefined) => {
    if (!sheet) return;
    const mapping = { ...sheet.mapping };
    if (idx === undefined) delete mapping[field]; else mapping[field] = idx;
    const r = parseSheetRows(sheet.rows, sheet.fileName, { headerRow: sheet.headerRow, mapping });
    setSheet({ ...sheet, mapping });
    setResult(r);
  };

  const accept = () => {
    if (!result) return;
    const started = session && Object.values(session.stops).some((s) => s.packages.some((p) => p.status !== 'pending'));
    if (started && !confirmReplace) { setConfirmReplace(true); return; }
    loadImport(result);
    setConfirmReplace(false);
    setResult(null);
    onDone();
  };

  const pkgCount = result?.stops.reduce((s, x) => s + x.packages.length, 0) ?? 0;
  const extras = result?.stops.reduce((s, x) => s + x.packages.filter((p) => p.extra).length, 0) ?? 0;

  return (
    <div className="screen">
      <h2>Importar rota</h2>
      <p className="muted">Planilha exportada da Shopee (.xlsx, .xls, .csv) ou PDF de rota já organizada.</p>
      <label className="file">
        <input type="file" accept=".pdf,.xlsx,.xls,.csv,application/pdf" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <span>📂 Escolher arquivo</span>
      </label>
      {busy ? <div className="info">{busy}</div> : null}
      {error ? <div className="err">{error}</div> : null}

      {sheet ? (
        <details className="box" open={result?.issues.some((i) => i.message.includes('coluna'))}>
          <summary>Colunas da planilha (confira o mapeamento)</summary>
          {(Object.keys(FIELD_LABEL) as Field[]).map((f) => (
            <div key={f} className="maprow">
              <span>{FIELD_LABEL[f]}</span>
              <select value={sheet.mapping[f] ?? ''} onChange={(e) => remap(f, e.target.value === '' ? undefined : parseInt(e.target.value, 10))}>
                <option value="">— não usar —</option>
                {sheet.headers.map((h, i) => <option key={i} value={i}>{h || `Coluna ${i + 1}`}</option>)}
              </select>
            </div>
          ))}
        </details>
      ) : null}

      {result ? (
        <div className="stack">
          <div className="box">
            <b>{result.title ?? result.fileName}</b>
            <div className="stats">
              <div><big>{result.stops.length}</big>paradas</div>
              <div><big>{pkgCount}</big>pacotes</div>
              <div><big>{result.groups.length || '—'}</big>grupos</div>
              <div><big>{extras}</big>“+N” sem nº</div>
            </div>
            {result.declared ? <div className="muted">Cabeçalho do arquivo: {result.declared.packages} pacotes · {result.declared.stops} paradas</div> : null}
          </div>
          {result.issues.length ? (
            <div className="stack">
              <h3>Conferência automática</h3>
              {result.issues.map((i, k) => <div key={k} className={i.level === 'erro' ? 'err' : i.level === 'aviso' ? 'warn' : 'info'}>{i.message}</div>)}
            </div>
          ) : <div className="ok">Nenhuma inconsistência encontrada.</div>}
          <button className="btn primary big" disabled={!result.stops.length} onClick={accept}>Usar esta rota</button>
        </div>
      ) : null}

      <Modal open={confirmReplace} title="Substituir rota atual?" onClose={() => setConfirmReplace(false)}>
        <p>A rota atual já tem entregas marcadas. Ao importar, o progresso dela deixa de aparecer.</p>
        <div className="row">
          <button className="btn danger" onClick={accept}>Substituir</button>
          <button className="btn" onClick={() => setConfirmReplace(false)}>Cancelar</button>
        </div>
      </Modal>
    </div>
  );
}
