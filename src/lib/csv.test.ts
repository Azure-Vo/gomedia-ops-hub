import { describe, expect, it } from 'vitest';
import { parseCsv, readFileText, toCsv } from './csv';

describe('CSV files from Excel and Google Sheets', () => {
  it('reads semicolon files (Excel on Vietnamese Windows) with a BOM and quoted cells', () => {
    const { header, rows } = parseCsv('﻿item_name;unit;unit_price\r\n"Bài đăng; thiết kế";bài;600.000\r\n');
    expect(header).toEqual(['item_name', 'unit', 'unit_price']);
    expect(rows).toEqual([{ item_name: 'Bài đăng; thiết kế', unit: 'bài', unit_price: '600.000' }]);
  });

  it('reads comma files (Google Sheets) and ignores blank lines', () => {
    const { rows } = parseCsv('task_name,owner_email\nBanner,a@go.vn\n\n,\n');
    expect(rows).toEqual([{ task_name: 'Banner', owner_email: 'a@go.vn' }]);
  });

  it('turns a Windows-1258 file into the same text as a name typed in the app', async () => {
    // "Video sản phẩm" in Windows-1258: tone marks are separate bytes (0xD2 = hook above).
    const bytes = Uint8Array.from([...Buffer.from('Video s'), 0x61, 0xd2, ...Buffer.from('n ph'), 0xe2, 0xd2, 0x6d]);
    const text = await readFileText(new File([bytes], 'old-excel.csv'));
    expect(text).toBe('Video sản phẩm'.normalize('NFC'));
  });

  it('writes UTF-8 with a BOM and quotes cells that need it', () => {
    expect(toCsv([{ a: 'x,y', b: 'ok' }])).toBe('﻿a,b\r\n"x,y",ok');
  });
});
