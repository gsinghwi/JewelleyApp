/* Xlsx: writes simple Excel workbooks and reads the first table of an uploaded .xlsx or .csv file.
 * No outside library: an .xlsx file is a zip of XML parts. Files are written uncompressed (Excel
 * accepts that) and read with the browser's own deflate support. */
(function (global) {
  'use strict';

  /* ---------- zip ---------- */

  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // files: [{ name, text }] -> Uint8Array of a zip with stored (uncompressed) entries
  function zip(files) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    files.forEach((f) => {
      const name = enc.encode(f.name);
      const data = enc.encode(f.text);
      const crc = crc32(data);
      const head = new DataView(new ArrayBuffer(30));
      head.setUint32(0, 0x04034b50, true);
      head.setUint16(4, 20, true);
      head.setUint16(6, 0x0800, true); // names are UTF-8
      head.setUint16(10, 0, true);
      head.setUint16(12, 0x5821, true); // 1 Jan 2024
      head.setUint32(14, crc, true);
      head.setUint32(18, data.length, true);
      head.setUint32(22, data.length, true);
      head.setUint16(26, name.length, true);
      parts.push(new Uint8Array(head.buffer), name, data);
      const dir = new DataView(new ArrayBuffer(46));
      dir.setUint32(0, 0x02014b50, true);
      dir.setUint16(4, 20, true);
      dir.setUint16(6, 20, true);
      dir.setUint16(8, 0x0800, true);
      dir.setUint16(14, 0x5821, true);
      dir.setUint32(16, crc, true);
      dir.setUint32(20, data.length, true);
      dir.setUint32(24, data.length, true);
      dir.setUint16(28, name.length, true);
      dir.setUint32(42, offset, true);
      central.push(new Uint8Array(dir.buffer), name);
      offset += 30 + name.length + data.length;
    });
    const dirSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, dirSize, true);
    end.setUint32(16, offset, true);
    const all = parts.concat(central, [new Uint8Array(end.buffer)]);
    const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
    let at = 0;
    all.forEach((p) => { out.set(p, at); at += p.length; });
    return out;
  }

  async function inflate(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // Uint8Array of a zip -> { name: Uint8Array } (only the parts asked for, to keep it quick)
  async function unzip(bytes, want) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw new Error('This is not an Excel (.xlsx) file');
    const count = v.getUint16(end + 10, true);
    let p = v.getUint32(end + 16, true);
    const dec = new TextDecoder();
    const out = {};
    for (let n = 0; n < count; n++) {
      if (v.getUint32(p, true) !== 0x02014b50) throw new Error('The Excel file is damaged');
      const method = v.getUint16(p + 10, true);
      const size = v.getUint32(p + 20, true);
      const nameLen = v.getUint16(p + 28, true);
      const extraLen = v.getUint16(p + 30, true);
      const commentLen = v.getUint16(p + 32, true);
      const local = v.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      if (!want(name)) continue;
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + size);
      if (method === 0) out[name] = data;
      else if (method === 8) out[name] = await inflate(data);
      else throw new Error('This Excel file uses a format the app cannot read; save it again as .xlsx');
    }
    return out;
  }

  /* ---------- writing ---------- */

  const xmlEsc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

  function colName(i) {
    let s = '';
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }

  // Cell styles used by write(): index into cellXfs below
  const STYLE = { text: 0, head: 1, input: 2, inputWt: 3, wt: 4, date: 5, wrap: 6, money: 7 };
  function xf(numFmt, font, fill, border, align) {
    return '<xf numFmtId="' + numFmt + '" fontId="' + font + '" fillId="' + fill + '" borderId="' + border + '" xfId="0"' +
      (numFmt ? ' applyNumberFormat="1"' : '') + (font ? ' applyFont="1"' : '') + (fill ? ' applyFill="1"' : '') + (border ? ' applyBorder="1"' : '') +
      (align ? ' applyAlignment="1">' + align + '</xf>' : '/>');
  }
  const STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="2"><numFmt numFmtId="164" formatCode="0.000"/><numFmt numFmtId="165" formatCode="dd\\-mm\\-yyyy"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE8DCC8"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/></patternFill></fill></fills>' +
    '<borders count="2"><border/><border><left style="thin"><color rgb="FFBFA9A0"/></left><right style="thin"><color rgb="FFBFA9A0"/></right>' +
    '<top style="thin"><color rgb="FFBFA9A0"/></top><bottom style="thin"><color rgb="FFBFA9A0"/></bottom></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8">' +
    xf(0, 0, 0, 0) +
    xf(0, 1, 2, 0, '<alignment wrapText="1" vertical="center"/>') +
    xf(0, 0, 3, 1) +
    xf(164, 0, 3, 1) +
    xf(164, 0, 0, 0) +
    xf(165, 0, 0, 0) +
    xf(0, 0, 0, 0, '<alignment wrapText="1" vertical="top"/>') +
    xf(2, 0, 0, 0) +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  function dateSerial(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000) : null;
  }

  // cell: plain value, or { v, s (style name), f (formula) }
  function cellXml(ref, c) {
    const o = c !== null && typeof c === 'object' ? c : { v: c };
    const s = o.s ? ' s="' + STYLE[o.s] + '"' : '';
    if (o.f) return '<c r="' + ref + '"' + s + '><f>' + xmlEsc(o.f) + '</f></c>';
    let v = o.v;
    if (o.s === 'date' && typeof v === 'string') v = dateSerial(v);
    if (v === '' || v == null) return s ? '<c r="' + ref + '"' + s + '/>' : '';
    if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"' + s + '><v>' + v + '</v></c>';
    return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>';
  }

  /* sheet: { name, rows: [[cell]], widths: [chars], freeze: true, hidden: true,
   *          lists: [{ col, ref }] }  (a dropdown on a column, ref like Lists!$A$2:$A$9) */
  function sheetXml(sh) {
    const rows = sh.rows.map((r, i) => '<row r="' + (i + 1) + '">' + r.map((c, j) => cellXml(colName(j) + (i + 1), c)).join('') + '</row>').join('');
    const cols = sh.widths ? '<cols>' + sh.widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>' : '';
    const view = sh.freeze
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
    const last = Math.max(sh.rows.length, 2) + 500; // room for rows the shop adds
    const dv = (sh.lists || []).length ? '<dataValidations count="' + sh.lists.length + '">' + sh.lists.map((l) =>
      '<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="' + colName(l.col) + '2:' + colName(l.col) + last + '"><formula1>' + xmlEsc(l.ref) + '</formula1></dataValidation>').join('') + '</dataValidations>' : '';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + view +
      '<sheetFormatPr defaultRowHeight="15"/>' + cols + '<sheetData>' + rows + '</sheetData>' + dv + '</worksheet>';
  }

  // sheets: [sheet] -> Uint8Array of an .xlsx file
  function write(sheets) {
    const n = sheets.length;
    const ids = sheets.map((_, i) => i + 1);
    const files = [
      { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        ids.map((i) => '<Override PartName="/xl/worksheets/sheet' + i + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
        '</Types>' },
      { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<bookViews><workbookView/></bookViews><sheets>' +
        sheets.map((s, i) => '<sheet name="' + xmlEsc(s.name) + '" sheetId="' + (i + 1) + '"' + (s.hidden ? ' state="hidden"' : '') + ' r:id="rId' + (i + 1) + '"/>').join('') +
        '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        ids.map((i) => '<Relationship Id="rId' + i + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + i + '.xml"/>').join('') +
        '<Relationship Id="rId' + (n + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', text: STYLES_XML },
    ].concat(sheets.map((s, i) => ({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', text: sheetXml(s) })));
    return zip(files);
  }

  /* ---------- reading ---------- */

  const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  function xmlDoc(bytes) {
    const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('The Excel file is damaged');
    return doc;
  }
  const byTag = (node, tag) => Array.from(node.getElementsByTagNameNS('*', tag));
  const textOf = (node) => byTag(node, 't').filter((t) => !t.closest || !t.closest('rPh')).map((t) => t.textContent).join('');

  function colIndex(ref) {
    let n = 0;
    for (const ch of ref) {
      const c = ch.charCodeAt(0);
      if (c < 65 || c > 90) break;
      n = n * 26 + (c - 64);
    }
    return n - 1;
  }

  // Reads the sheet named `prefer` (else the first sheet) -> array of rows of raw values
  async function readXlsx(bytes, prefer) {
    const parts = await unzip(bytes, (name) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(name));
    if (!parts['xl/workbook.xml']) throw new Error('This is not an Excel (.xlsx) file');
    const wb = xmlDoc(parts['xl/workbook.xml']);
    const sheets = byTag(wb, 'sheet');
    const pick = sheets.find((s) => (s.getAttribute('name') || '').toLowerCase() === String(prefer || '').toLowerCase()) || sheets[0];
    if (!pick) throw new Error('The Excel file has no sheets');
    let path = 'xl/worksheets/sheet1.xml';
    const rid = pick.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || pick.getAttribute('r:id');
    if (parts['xl/_rels/workbook.xml.rels'] && rid) {
      const rel = byTag(xmlDoc(parts['xl/_rels/workbook.xml.rels']), 'Relationship').find((r) => r.getAttribute('Id') === rid);
      if (rel) {
        const t = rel.getAttribute('Target');
        path = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
      }
    }
    if (!parts[path]) throw new Error('The Excel file is damaged');
    const shared = parts['xl/sharedStrings.xml'] ? byTag(xmlDoc(parts['xl/sharedStrings.xml']), 'si').map(textOf) : [];
    const rows = [];
    byTag(xmlDoc(parts[path]), 'row').forEach((r, ri) => {
      const rn = parseInt(r.getAttribute('r'), 10) || ri + 1;
      const row = [];
      byTag(r, 'c').forEach((c, ci) => {
        const ref = c.getAttribute('r');
        const j = ref ? colIndex(ref) : ci;
        const t = c.getAttribute('t');
        const vEl = byTag(c, 'v')[0];
        const raw = vEl ? vEl.textContent : '';
        let v;
        if (t === 's') v = shared[parseInt(raw, 10)] || '';
        else if (t === 'inlineStr') v = textOf(c);
        else if (t === 'str' || t === 'e') v = t === 'e' ? '' : raw;
        else if (t === 'b') v = raw === '1';
        else v = raw === '' ? '' : Number(raw);
        row[j] = v;
      });
      rows[rn - 1] = row;
    });
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    return rows;
  }

  // Minimal CSV parser (quoted fields, commas and new lines inside quotes)
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cur = '';
    let q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); rows.push(row); row = []; cur = '';
      } else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  // File (.xlsx or .csv) -> array of rows of values
  async function readFile(file, prefer) {
    const buf = new Uint8Array(await file.arrayBuffer());
    if (buf[0] === 0x50 && buf[1] === 0x4b) return readXlsx(buf, prefer);
    if (/\.xls$/i.test(file.name) || (buf[0] === 0xd0 && buf[1] === 0xcf)) throw new Error('Old .xls files are not supported; in Excel use File > Save As > Excel Workbook (.xlsx)');
    return parseCSV(new TextDecoder().decode(buf));
  }

  // Excel date number (days since 30 Dec 1899) -> YYYY-MM-DD
  function serialToISO(n) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
    return d.toISOString().slice(0, 10);
  }

  global.Xlsx = { write, readFile, readXlsx, parseCSV, serialToISO, dateSerial, colName, MIME };
})(window);
