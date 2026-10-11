import { describe, expect, it } from "vitest";
import { buildXlsx, columnName, crc32 } from "./xlsx";

describe("xlsx writer", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("names columns like a spreadsheet", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
  });

  it("writes a zip with the workbook parts and typed cells", () => {
    const bytes = buildXlsx("Slices", [["a & b", 1.5], [null, -2]]);
    const text = new TextDecoder().decode(bytes);
    expect(bytes[0]).toBe(0x50); // "PK"
    expect(bytes[1]).toBe(0x4b);
    for (const part of ["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]) {
      expect(text).toContain(part);
    }
    expect(text).toContain('<c r="A1" t="inlineStr"><is><t xml:space="preserve">a &amp; b</t></is></c>');
    expect(text).toContain('<c r="B1"><v>1.5</v></c>');
    expect(text).toContain('<c r="B2"><v>-2</v></c>');
    expect(text).not.toContain('r="A2"');
  });
});
