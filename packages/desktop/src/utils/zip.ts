/**
 * A minimal ZIP reader and writer for project files that are ZIP archives
 * (.gsz, .cslp): reading takes stored and deflated entries (deflate through
 * the platform's DecompressionStream); writing stores the entries
 * uncompressed (writeZip) or deflates them (writeZipDeflated, through
 * CompressionStream).
 *
 * Reading is lazy: openZip reads the central directory only, and an entry
 * is unpacked when it is asked for (a project's assets are never unpacked
 * unless shown). readZip unpacks the wanted entries at once.
 *
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
  /**
   * Largest total of the deflated entries read, uncompressed. (A stored
   * entry is a copy of bytes the archive holds: it cannot unpack to more
   * than the archive's own size, and does not count.)
   */
  totalBytes: number;
}

/** The limits the importers use: 100 MB per entry, 200 MB in all. */
export const ZIP_LIMITS: ZipLimits = { entryBytes: 100 * 1024 * 1024, totalBytes: 200 * 1024 * 1024 };

const megabytes = (n: number) => `${Math.ceil(n / (1024 * 1024))} MB`;

/** An entry of the central directory, as declared (nothing unpacked yet). */
export interface ZipEntryInfo {
  name: string;
  /** The uncompressed size the central directory declares. */
  size: number;
  /** The compressed size the central directory declares. */
  compressedSize: number;
  /** 0: stored, 8: deflated. */
  method: number;
  /** Encrypted entries cannot be read. */
  encrypted: boolean;
  /** Offset of the local header. */
  local: number;
}

/**
 * An open archive: its central directory, and entries unpacked on demand.
 * The declared sizes are checked against the limits before an entry is
 * unpacked (the entry's against `entryBytes`, the running total of what
 * deflated entries unpacked plus the entry's against `totalBytes`), and an entry that
 * unpacks to more than it declares is refused as damaged, so an archive
 * can never unpack to more than the limits allow, however many entries it
 * has. An entry read twice is unpacked once.
 */
export interface ZipArchive {
  /** The entries by name, in central directory order (directories left out). */
  entries(): ZipEntryInfo[];
  has(name: string): boolean;
  /** The entry's declared uncompressed size, or undefined without the entry. */
  size(name: string): number | undefined;
  /** The entry unpacked; throws without the entry or when it cannot be read within the limits. */
  read(name: string): Promise<Uint8Array>;
  /** What the deflated entries read so far unpacked to (bytes). */
  unpacked(): number;
}

/** Open an archive: read its central directory, unpack nothing. */
export function openZip(bytes: Uint8Array, limits: ZipLimits = ZIP_LIMITS): ZipArchive {
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
  const index = new Map<string, ZipEntryInfo>();
  for (let k = 0; k < count; k++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw new Error("Damaged ZIP archive (central directory).");
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const compressedSize = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const local = u32(bytes, p + 42);
    const name = textDecoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    // (a name listed twice: the last one, as readers usually take it)
    index.set(name, { name, size, compressedSize, method, encrypted: (flags & 1) !== 0, local });
  }
  const cache = new Map<string, Uint8Array>();
  let total = 0;

  async function unpack(e: ZipEntryInfo): Promise<Uint8Array> {
    const { name, method, size, compressedSize, local } = e;
    if (e.encrypted) throw new Error(`Encrypted ZIP entry: ${name}`);
    // The declared sizes, before anything is unpacked.
    if (size > limits.entryBytes) {
      throw new Error(`The ZIP entry ${name} is too large to import (${megabytes(size)} unpacked; at most ${megabytes(limits.entryBytes)}).`);
    }
    if (method === 8 && total + size > limits.totalBytes) {
      throw new Error(`The ZIP archive is too large to import (its entries unpack to more than ${megabytes(limits.totalBytes)}).`);
    }
    if (local + 30 > bytes.length || u32(bytes, local) !== 0x04034b50) throw new Error("Damaged ZIP archive (local header).");
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    if (start + compressedSize > bytes.length) throw new Error(`Damaged ZIP archive (${name} is cut off).`);
    const data = bytes.subarray(start, start + compressedSize);
    let out: Uint8Array;
    if (method === 0) {
      if (compressedSize > size) throw new Error(`Damaged ZIP archive (${name} is larger than its header says).`);
      out = data.slice();
    } else if (method === 8) {
      try {
        // (what the stream really unpacks is bounded by the declared size)
        out = await inflateRaw(data, size);
      } catch (err) {
        if (err instanceof OversizeError) throw new Error(`Damaged ZIP archive (${name} is larger than its header says).`, { cause: err });
        throw new Error(`Damaged ZIP archive (${name} cannot be decompressed).`, { cause: err });
      }
    } else throw new Error(`Unsupported ZIP compression (method ${method}) for ${name}`);
    if (method === 8) total += size;
    return out;
  }

  return {
    entries: () => [...index.values()],
    has: (name) => index.has(name),
    size: (name) => index.get(name)?.size,
    unpacked: () => total,
    async read(name) {
      const cached = cache.get(name);
      if (cached) return cached;
      const e = index.get(name);
      if (!e) throw new Error(`The ZIP archive has no entry ${name}.`);
      const out = await unpack(e);
      cache.set(name, out);
      return out;
    },
  };
}

/**
 * The entries of a ZIP archive by name (directories left out), unpacked;
 * with `want`, only the entries it accepts are read. The limits are those
 * of openZip, over the entries read.
 */
export async function readZip(bytes: Uint8Array, want?: (name: string) => boolean, limits: ZipLimits = ZIP_LIMITS): Promise<Map<string, Uint8Array>> {
  const archive = openZip(bytes, limits);
  const out = new Map<string, Uint8Array>();
  for (const e of archive.entries()) {
    if (want && !want(e.name)) continue;
    out.set(e.name, await archive.read(e.name));
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

/** An entry to write. */
export interface ZipInput {
  name: string;
  data: Uint8Array | string;
  /**
   * writeZipDeflated: "store" keeps the entry as it is (for data that is
   * compressed already, such as PNG images); the default deflates it.
   */
  method?: "deflate" | "store";
}

/** What the archive records besides the entries. */
export interface ZipWriteOptions {
  /**
   * The modification time written in every entry's header (DOS time, local,
   * 2 s resolution, 1980 at the earliest). The default is a constant
   * (1980-01-01 00:00), so the same entries give the same archive.
   */
  time?: Date;
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
export function writeZip(entries: ZipInput[], options: ZipWriteOptions = {}): Uint8Array {
  return packZip(
    entries.map((e) => {
      const data = toBytes(e.data);
      return { name: e.name, data, stored: data, method: 0 };
    }),
    options,
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

/** A ZIP archive of the given entries, deflated (entries marked "store" as they are). */
export async function writeZipDeflated(entries: ZipInput[], options: ZipWriteOptions = {}): Promise<Uint8Array> {
  const packed: PackedEntry[] = [];
  for (const e of entries) {
    const data = toBytes(e.data);
    if (e.method === "store") packed.push({ name: e.name, data, stored: data, method: 0 });
    else packed.push({ name: e.name, data, stored: await deflateRaw(data), method: 8 });
  }
  return packZip(packed, options);
}

/** The DOS date and time fields of a ZIP header (local time, 2 s steps; before 1980 is 1980). */
export function dosDateTime(date?: Date): { date: number; time: number } {
  if (!date || !Number.isFinite(date.getTime()) || date.getFullYear() < 1980) return { date: (1 << 5) | 1, time: 0 };
  const d = date;
  const year = Math.min(d.getFullYear(), 2107) - 1980;
  return {
    date: (year << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  };
}

function packZip(entries: PackedEntry[], options: ZipWriteOptions): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  const stamp = dosDateTime(options.time);
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
    lv.setUint16(10, stamp.time, true);
    lv.setUint16(12, stamp.date, true);
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
    cv.setUint16(12, stamp.time, true);
    cv.setUint16(14, stamp.date, true);
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
