/**
 * A minimal ZIP reader and writer for project files that are ZIP archives
 * (.gsz, .cslp): reading takes stored and deflated entries (deflate through
 * the platform's DecompressionStream); writing stores the entries
 * uncompressed (writeZip) or deflates them (writeZipDeflated, through
 * CompressionStream).
 * No ZIP64, encryption or multi-disk archives.
 */

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function u16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}
function u32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

/** Thrown when an entry inflates to more than its header declares (the archive is damaged, or a bomb with a false size). */
class OversizeError extends Error {}

/**
 * Inflate a deflate-raw stream, reading chunk by chunk and stopping as soon
 * as the output passes `limit` bytes: a crafted stream can inflate to a
 * thousand times its size, so the output is never collected unbounded.
 */
async function inflateRaw(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  const reader = source.pipeThrough(new DecompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new OversizeError();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Whether the bytes start like a ZIP archive. */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && u32(bytes, 0) === 0x04034b50;
}

/** Limits on what an archive may unpack to (a real project archive is a few MB). */
export interface ZipLimits {
  /** Largest entry, uncompressed. */
  entryBytes: number;
  /** Largest total of the entries read, uncompressed. */
  totalBytes: number;
}

/** The limits the importers use: 100 MB per entry, 200 MB in all. */
export const ZIP_LIMITS: ZipLimits = { entryBytes: 100 * 1024 * 1024, totalBytes: 200 * 1024 * 1024 };

const megabytes = (n: number) => `${Math.ceil(n / (1024 * 1024))} MB`;

/**
 * The entries of a ZIP archive by name (directories left out); with `want`,
 * only the entries it accepts are read. The sizes the central directory
 * declares are checked against `limits` before an entry is unpacked, and an
 * entry that unpacks to more than it declares is refused as damaged, so an
 * archive can never unpack to more than the limits allow.
 */
export async function readZip(bytes: Uint8Array, want?: (name: string) => boolean, limits: ZipLimits = ZIP_LIMITS): Promise<Map<string, Uint8Array>> {
  // end of central directory: the last signature within the trailing 64 kB comment window
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a ZIP archive (no central directory).");
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const out = new Map<string, Uint8Array>();
  let total = 0;
  for (let k = 0; k < count; k++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw new Error("Damaged ZIP archive (central directory).");
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const compressed = u32(bytes, p + 20);
    const uncompressed = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const local = u32(bytes, p + 42);
    const name = textDecoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/") || (want && !want(name))) continue;
    if (flags & 1) throw new Error(`Encrypted ZIP entry: ${name}`);
    // The declared sizes, before anything is unpacked.
    if (uncompressed > limits.entryBytes) {
      throw new Error(`The ZIP entry ${name} is too large to import (${megabytes(uncompressed)} unpacked; at most ${megabytes(limits.entryBytes)}).`);
    }
    total += uncompressed;
    if (total > limits.totalBytes) {
      throw new Error(`The ZIP archive is too large to import (its entries unpack to more than ${megabytes(limits.totalBytes)}).`);
    }
    if (u32(bytes, local) !== 0x04034b50) throw new Error("Damaged ZIP archive (local header).");
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    if (start + compressed > bytes.length) throw new Error(`Damaged ZIP archive (${name} is cut off).`);
    const data = bytes.subarray(start, start + compressed);
    if (method === 0) {
      if (compressed > uncompressed) throw new Error(`Damaged ZIP archive (${name} is larger than its header says).`);
      out.set(name, data.slice());
    } else if (method === 8) {
      try {
        // (what the stream really unpacks is bounded by the declared size)
        out.set(name, await inflateRaw(data, uncompressed));
      } catch (e) {
        if (e instanceof OversizeError) throw new Error(`Damaged ZIP archive (${name} is larger than its header says).`);
        throw new Error(`Damaged ZIP archive (${name} cannot be decompressed).`);
      }
    } else throw new Error(`Unsupported ZIP compression (method ${method}) for ${name}`);
  }
  return out;
}

let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** An entry as written: its uncompressed data and what is stored for it. */
interface PackedEntry {
  name: string;
  /** The uncompressed data (for the CRC and the declared size). */
  data: Uint8Array;
  /** The bytes stored in the archive (the data, or the data deflated). */
  stored: Uint8Array;
  /** 0: stored, 8: deflated. */
  method: 0 | 8;
}

const toBytes = (data: Uint8Array | string) => (typeof data === "string" ? textEncoder.encode(data) : data);

/** A ZIP archive of the given entries, stored without compression. */
export function writeZip(entries: { name: string; data: Uint8Array | string }[]): Uint8Array {
  return packZip(
    entries.map((e) => {
      const data = toBytes(e.data);
      return { name: e.name, data, stored: data, method: 0 };
    }),
  );
}

/** Deflate `data` to a raw deflate stream (as a ZIP entry stores it). */
async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  const stream = source.pipeThrough(new CompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream as unknown as BodyInit).arrayBuffer());
}

/** A ZIP archive of the given entries, deflated. */
export async function writeZipDeflated(entries: { name: string; data: Uint8Array | string }[]): Promise<Uint8Array> {
  const packed: PackedEntry[] = [];
  for (const e of entries) {
    const data = toBytes(e.data);
    packed.push({ name: e.name, data, stored: await deflateRaw(data), method: 8 });
  }
  return packZip(packed);
}

function packZip(entries: PackedEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = textEncoder.encode(e.name);
    const { data, stored, method } = e;
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, stored.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, stored.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    parts.push(local, stored);
    central.push(cen);
    offset += local.length + stored.length;
  }
  const cenSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cenSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of all) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}
