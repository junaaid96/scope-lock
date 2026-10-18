import { describe, expect, it } from "vitest";
import { CsvParseError, headerIndex, parseCsv } from "../src/csv.js";

describe("parseCsv", () => {
  it("parses headers, commas, quotes, and CRLF", () => {
    const table = parseCsv('title,description,priority\r\n"Login, SSO","Allows ""quoted"" logins",HIGH\r\nExport,Plain row,LOW\r\n');
    expect(table.header).toEqual(["title", "description", "priority"]);
    expect(table.rows).toEqual([
      ["Login, SSO", 'Allows "quoted" logins', "HIGH"],
      ["Export", "Plain row", "LOW"],
    ]);
  });

  it("keeps newlines inside quoted fields and skips blank lines", () => {
    const table = parseCsv('title,description\n"Multi","line one\nline two"\n\n"Next","row"\n');
    expect(table.rows).toEqual([
      ["Multi", "line one\nline two"],
      ["Next", "row"],
    ]);
  });

  it("fails with row-anchored errors instead of guessing", () => {
    expect(() => parseCsv('a,b\n"oops,never closed\nnext,row')).toThrowError(CsvParseError);
    expect(() => parseCsv('a,b\nva"l",x')).toThrowError(/Row 2/);
    expect(() => parseCsv("")).toThrowError(/no header row/);
    expect(() => parseCsv(`h\n${"r\n".repeat(501)}`)).toThrowError(/Too many rows/);
  });

  it("maps headers case-insensitively, first wins", () => {
    const map = headerIndex(["Title", "TITLE", "Priority"]);
    expect(map.get("title")).toBe(0);
    expect(map.get("priority")).toBe(2);
    expect(map.has("missing")).toBe(false);
  });
});
