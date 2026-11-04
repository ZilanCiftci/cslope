/**
 * The ZIP reader's lazy index and the writer's time stamps (the importers'
 * tests cover the limits and the crafted archives).
 */
import { describe, expect, it } from "vitest";
import { dosDateTime, openZip, readZip, writeZip, writeZipDeflated } from "./zip";

const enc = new TextEncoder();
const dec = new TextDecoder();
const MB = 1024 * 1024;

async function deflated(data: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(data);
      c.close();
    },
  });
  return new Uint8Array(
    await new Response(source.pipeThrough(new CompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)).arrayBuffer(),
  );
}

describe("openZip", () => {
  it("lists the entries without unpacking them, and unpacks one when it is read (once)", async () => {
    const bytes = await writeZipDeflated([
      { name: "a.json", data: "{}" },
      { name: "dir/" , data: "" },
      { name: "dir/b.bin", data: new Uint8Array(MB), method: "store" },
    ]);
    const archive = openZip(bytes);
    expect(archive.entries().map((e) => [e.name, e.size, e.method])).toEqual([
      ["a.json", 2, 8],
      ["dir/b.bin", MB, 0],
    ]);
    expect(archive.has("dir/")).toBe(false);
    expect(archive.size("dir/b.bin")).toBe(MB);
    expect(archive.size("none")).toBeUndefined();
    expect(archive.unpacked()).toBe(0);
    expect(dec.decode(await archive.read("a.json"))).toBe("{}");
    expect(archive.unpacked()).toBe(2);
    const first = await archive.read("dir/b.bin");
    expect(first).toBe(await archive.read("dir/b.bin"));
    expect(archive.unpacked()).toBe(2 + MB);
    await expect(archive.read("none")).rejects.toThrow("no entry none");
  });

  it("applies the limits to the entries read, not to those left alone", async () => {
    const bomb = await deflated(new Uint8Array(4 * MB));
    const bytes = await writeZipDeflated([{ name: "small.txt", data: "hello" }]);
    // a second archive with a huge declared entry beside the small one, by hand
    const limits = { entryBytes: MB, totalBytes: 2 * MB };
    const archive = openZip(bytes, limits);
    expect(dec.decode(await archive.read("small.txt"))).toBe("hello");
    // declared sizes decide before anything is unpacked
    const big = writeZip([
      { name: "a.bin", data: new Uint8Array(1_500_000) },
      { name: "b.bin", data: new Uint8Array(700_000) },
      { name: "c.bin", data: new Uint8Array(900_000) },
      { name: "d.bin", data: new Uint8Array(900_000) },
    ]);
    const lazy = openZip(big, limits);
    await expect(lazy.read("a.bin")).rejects.toThrow(/a\.bin is too large to import \(2 MB unpacked; at most 1 MB\)/);
    await lazy.read("b.bin");
    await lazy.read("c.bin");
    expect(lazy.unpacked()).toBe(1_600_000);
    await expect(lazy.read("d.bin")).rejects.toThrow(/archive is too large to import/);
    await expect(readZip(big, (n) => n !== "a.bin", limits)).rejects.toThrow(/archive is too large to import/);
    expect([...(await readZip(big, (n) => n === "b.bin", limits)).keys()]).toEqual(["b.bin"]);
    // a deflated entry that unpacks past its declared size is refused as damaged, bounded by the declaration
    const bytes2 = await writeZipDeflated([{ name: "z.bin", data: new Uint8Array(4 * MB) }]);
    const z = bytes2.slice();
    // declare 100 bytes in the central directory (offset 24 of the entry, after the local header and data)
    const cen = z.length - 22 - 46 - "z.bin".length;
    new DataView(z.buffer).setUint32(cen + 24, 100, true);
    await expect(openZip(z).read("z.bin")).rejects.toThrow(/z\.bin is larger than its header says/);
    expect(bomb.length).toBeLessThan(MB);
  });

  it("refuses what is not an archive, or is cut off", () => {
    expect(() => openZip(enc.encode("not a zip"))).toThrow(/no central directory/);
    const bytes = writeZip([{ name: "a", data: "x" }]);
    expect(() => openZip(bytes.subarray(0, bytes.length - 10))).toThrow(/no central directory/);
  });
});

describe("writing", () => {
  it("stamps every entry with the given time, or a constant", async () => {
    const time = new Date(2026, 10, 4, 12, 34, 57);
    const stamp = dosDateTime(time);
    expect(stamp).toEqual({ date: ((2026 - 1980) << 9) | (11 << 5) | 4, time: (12 << 11) | (34 << 5) | 28 });
    const bytes = await writeZipDeflated([{ name: "a", data: "x" }, { name: "b", data: "y", method: "store" }], { time });
    for (const e of openZip(bytes).entries()) {
      expect(bytes[e.local + 10] | (bytes[e.local + 11] << 8)).toBe(stamp.time);
      expect(bytes[e.local + 12] | (bytes[e.local + 13] << 8)).toBe(stamp.date);
    }
    const plain = writeZip([{ name: "a", data: "x" }]);
    expect(plain[12] | (plain[13] << 8)).toBe((1 << 5) | 1); // 1980-01-01
    expect(plain[10] | (plain[11] << 8)).toBe(0);
    expect(dosDateTime(new Date(1970, 0, 1))).toEqual({ date: (1 << 5) | 1, time: 0 });
    expect(dosDateTime(new Date(NaN))).toEqual({ date: (1 << 5) | 1, time: 0 });
  });

  it("writes the same bytes for the same entries", async () => {
    const entries = [{ name: "a.json", data: "{\n}\n" }, { name: "b.png", data: new Uint8Array([1, 2, 3]), method: "store" as const }];
    expect(await writeZipDeflated(entries)).toEqual(await writeZipDeflated(entries));
    expect(openZip(await writeZipDeflated(entries)).entries().map((e) => e.method)).toEqual([8, 0]);
  });
});
