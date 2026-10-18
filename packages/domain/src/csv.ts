// Minimal RFC-4180 CSV parser for requirement imports: commas, quoted
// fields, escaped double-quotes, and CRLF/LF newlines (including newlines
// inside quoted fields). No dependencies; unforgiving inputs fail with a
// row-anchored error instead of guessing.

export interface CsvTable {
  header: string[];
  rows: string[][];
}

export class CsvParseError extends Error {
  readonly row: number;
  constructor(row: number, message: string) {
    super(`Row ${row}: ${message}`);
    this.name = "CsvParseError";
    this.row = row;
  }
}

export const CSV_MAX_BYTES = 512 * 1024;
export const CSV_MAX_ROWS = 500;
export const CSV_MAX_COLUMNS = 20;

/** Parse CSV text into a header + rows. Throws CsvParseError on malformed input. */
export function parseCsv(text: string): CsvTable {
  if (text.length > CSV_MAX_BYTES) {
    throw new CsvParseError(1, `File is larger than the ${CSV_MAX_BYTES} byte limit`);
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let rowNum = 1;
  let i = 0;
  const pushField = (): void => {
    row.push(field);
    field = "";
  };
  const pushRow = (): void => {
    pushField();
    // Skip fully blank lines (a trailing newline must not create a phantom row).
    if (!(row.length === 1 && row[0]?.trim() === "")) rows.push(row);
    row = [];
    rowNum += 1;
  };
  while (i < text.length) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
    } else if (ch === '"') {
      if (field !== "") throw new CsvParseError(rowNum, "Unexpected quote inside an unquoted field");
      inQuotes = true;
      i += 1;
    } else if (ch === ",") {
      pushField();
      i += 1;
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      pushRow();
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (inQuotes) throw new CsvParseError(rowNum, "Unterminated quoted field");
  pushRow();
  if (rows.length === 0) throw new CsvParseError(1, "CSV has no header row");
  const [header, ...rest] = rows as [string[], ...string[][]];
  if (header.length > CSV_MAX_COLUMNS) throw new CsvParseError(1, `Too many columns (max ${CSV_MAX_COLUMNS})`);
  if (rest.length > CSV_MAX_ROWS) throw new CsvParseError(1, `Too many rows (max ${CSV_MAX_ROWS})`);
  return { header: header.map((h) => h.trim()), rows: rest };
}

/** Map header names (case-insensitive) to column indexes. */
export function headerIndex(header: string[]): Map<string, number> {
  const map = new Map<string, number>();
  header.forEach((h, i) => {
    const key = h.toLowerCase();
    if (!map.has(key)) map.set(key, i);
  });
  return map;
}
