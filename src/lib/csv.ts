// CSV reading (Excel / Google Sheets exports) and writing (UTF-8 with BOM, so Excel shows Vietnamese).

export function parseCsv(text: string): { header: string[]; rows: Record<string, string>[] } {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const counts = { ',': 0, ';': 0, '\t': 0 } as Record<string, number>;
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const sep = best && best[1] > 0 ? best[0] : ',';
  const records: string[][] = [];
  let field = '';
  let rec: string[] = [];
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === sep) {
      rec.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      rec.push(field);
      records.push(rec);
      rec = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || rec.length) {
    rec.push(field);
    records.push(rec);
  }
  const nonEmpty = records.filter((r) => r.some((v) => v.trim() !== ''));
  const header = (nonEmpty.shift() ?? []).map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const rows = nonEmpty.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
  return { header, rows };
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  return '\uFEFF' + [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
}

export function downloadText(filename: string, content: string, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readFileText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  // Files saved by old Excel versions may be Windows-1258; replacement characters reveal that.
  // Windows-1258 stores Vietnamese tone marks as separate characters, so normalise to NFC:
  // otherwise "Video sản phẩm" from the file would not match the same name typed in the app.
  if (utf8.includes('\uFFFD')) {
    try {
      return new TextDecoder('windows-1258').decode(buf).normalize('NFC');
    } catch {
      return utf8.normalize('NFC');
    }
  }
  return utf8.normalize('NFC');
}
