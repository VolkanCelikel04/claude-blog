/**
 * A workbook is modelled as sheets of plain strings. That is all the vault
 * needs, and it keeps the file something a person can open in Excel and read.
 *
 * Written with inline strings; read back from either inline strings or the
 * shared-string table, because Excel rewrites the file in the latter form the
 * first time a user saves it by hand.
 */
import { zipRead, zipWrite } from './zip.ts';
import { attr, columnIndex, columnName, escapeXml, unescapeXml } from './xml.ts';

export interface Sheet {
  name: string;
  rows: string[][];
}

const CONTENT_TYPES = (sheetCount: number): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${Array.from(
  { length: sheetCount },
  (_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
).join('\n')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

/** Two styles: a bold, shaded header row and a default body cell. */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EDF3"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
</styleSheet>`;

export function writeWorkbook(sheets: readonly Sheet[]): Buffer {
  if (sheets.length === 0) throw new Error('En az bir sayfa gerekli.');

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
${sheets
  .map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
  .join('\n')}
</sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets
  .map(
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  )
  .join('\n')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const entries = [
    { path: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES(sheets.length), 'utf8') },
    { path: '_rels/.rels', data: Buffer.from(ROOT_RELS, 'utf8') },
    { path: 'xl/workbook.xml', data: Buffer.from(workbook, 'utf8') },
    { path: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRels, 'utf8') },
    { path: 'xl/styles.xml', data: Buffer.from(STYLES, 'utf8') },
    ...sheets.map((sheet, i) => ({
      path: `xl/worksheets/sheet${i + 1}.xml`,
      data: Buffer.from(renderSheet(sheet), 'utf8'),
    })),
  ];

  return zipWrite(entries);
}

function renderSheet(sheet: Sheet): string {
  const rows = sheet.rows
    .map((cells, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const styleAttr = rowIndex === 0 ? ' s="1"' : '';
      const rendered = cells
        .map((value, cellIndex) => {
          if (value === undefined || value === null || value === '') return '';
          const ref = `${columnName(cellIndex)}${rowNumber}`;
          return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(
            String(value),
          )}</t></is></c>`;
        })
        .join('');
      return `<row r="${rowNumber}">${rendered}</row>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
}

export function readWorkbook(buffer: Buffer): Sheet[] {
  const files = zipRead(buffer);

  const workbookXml = files.get('xl/workbook.xml')?.toString('utf8');
  if (!workbookXml) throw new Error('Gecersiz .xlsx: xl/workbook.xml yok.');

  const relsXml = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';
  const relations = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const id = attr(match[1], 'Id');
    const target = attr(match[1], 'Target');
    if (id && target) relations.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''));
  }

  const sharedStrings = readSharedStrings(files);
  const sheets: Sheet[] = [];

  for (const match of workbookXml.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const name = attr(match[1], 'name');
    if (!name) continue;
    const relationId = attr(match[1], 'r:id') ?? attr(match[1], 'id');
    const target = relationId ? relations.get(relationId) : undefined;
    const path = target ? `xl/${target}` : `xl/worksheets/sheet${sheets.length + 1}.xml`;

    const sheetXml = files.get(path)?.toString('utf8');
    sheets.push({ name, rows: sheetXml ? parseSheet(sheetXml, sharedStrings) : [] });
  }

  return sheets;
}

function readSharedStrings(files: Map<string, Buffer>): string[] {
  const xml = files.get('xl/sharedStrings.xml')?.toString('utf8');
  if (!xml) return [];

  const strings: string[] = [];
  for (const item of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    // Rich text splits one value across several <t> runs; join them back.
    const runs = [...item[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1]));
    strings.push(runs.join(''));
  }
  return strings;
}

function parseSheet(xml: string, sharedStrings: readonly string[]): string[][] {
  const rows: string[][] = [];

  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNumber = Number(attr(rowMatch[1], 'r') ?? rows.length + 1);
    const body = rowMatch[2] ?? '';
    const cells: string[] = [];

    for (const cellMatch of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = cellMatch[1];
      const content = cellMatch[2] ?? '';
      const reference = attr(tag, 'r');
      const index = reference ? columnIndex(reference) : cells.length;
      cells[index] = decodeCell(attr(tag, 't'), content, sharedStrings);
    }

    // Sparse rows keep their position: row 5 stays row 5.
    for (let i = rows.length; i < rowNumber - 1; i += 1) rows[i] = [];
    rows[rowNumber - 1] = normalise(cells);
  }

  return rows.map((row) => (row ? normalise(row) : []));
}

function normalise(cells: readonly (string | undefined)[]): string[] {
  return Array.from({ length: cells.length }, (_, i) => cells[i] ?? '');
}

function decodeCell(
  type: string | undefined,
  content: string,
  sharedStrings: readonly string[],
): string {
  if (type === 'inlineStr') {
    const runs = [...content.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1]));
    return runs.join('');
  }

  const value = /<v>([\s\S]*?)<\/v>/.exec(content)?.[1];
  if (value === undefined) return '';

  if (type === 's') {
    const index = Number(unescapeXml(value));
    return sharedStrings[index] ?? '';
  }
  if (type === 'b') return unescapeXml(value) === '1' ? 'TRUE' : 'FALSE';

  return unescapeXml(value);
}
