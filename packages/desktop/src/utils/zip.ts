/**
 * A minimal ZIP reader and writer for project files that are ZIP archives
 * (.gsz): reading takes stored and deflated entries (deflate through the
 * platform's DecompressionStream), writing stores the entries uncompressed.
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

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  const stream = source.pipeThrough(new DecompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Whether the bytes start like a ZIP archive. */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && u32(bytes, 0) === 0x04034b50;
}

/** The entries of a ZIP archive by name (directories left out); with `want`, only the entries it accepts are read. */
export async function readZip(bytes: Uint8Array, want?: (name: string) => boolean): Promise<Map<string, Uint8Array>> {
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
  for (let k = 0; k < count; k++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error("Damaged ZIP archive (central directory).");
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const compressed = u32(bytes, p + 20);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const local = u32(bytes, p + 42);
    const name = textDecoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/") || (want && !want(name))) continue;
    if (flags & 1) throw new Error(`Encrypted ZIP entry: ${name}`);
    if (u32(bytes, local) !== 0x04034b50) throw new Error("Damaged ZIP archive (local header).");
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    const data = bytes.subarray(start, start + compressed);
    if (method === 0) out.set(name, data.slice());
    else if (method === 8) out.set(name, await inflateRaw(data));
    else throw new Error(`Unsupported ZIP compression (method ${method}) for ${name}`);
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

/** A ZIP archive of the given entries, stored without compression. */
export function writeZip(entries: { name: string; data: Uint8Array | string }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = textEncoder.encode(e.name);
    const data = typeof e.data === "string" ? textEncoder.encode(e.data) : e.data;
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    parts.push(local, data);
    central.push(cen);
    offset += local.length + data.length;
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
