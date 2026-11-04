// Changes one byte inside a file of an asar archive, in place, for the
// package smoke test (.github/workflows/package-smoke.yml): with the
// embedded asar integrity fuse on, the packaged app must refuse to start
// once a file it reads at startup differs from the hash in cSlope.exe.
//
//   bun scripts/tamper-asar.ts <app.asar> [file inside, default dist-electron/main.js]
//
// Archive layout: a 4-byte size, then a pickle holding the JSON header,
// then the files; a file's entry gives its offset after the header.
import { openSync, readSync, writeSync, closeSync } from "node:fs";

interface Entry {
  files?: Record<string, Entry>;
  offset?: string;
  size?: number;
  unpacked?: boolean;
}

export function locate(header: Entry, path: string): { offset: number; size: number } {
  let node: Entry | undefined = header;
  for (const part of path.split("/")) node = node?.files?.[part];
  if (!node || node.offset === undefined || node.size === undefined || node.unpacked) {
    throw new Error(`${path} is not a packed file of the archive`);
  }
  return { offset: Number(node.offset), size: node.size };
}

export function tamper(archive: string, path: string): number {
  const fd = openSync(archive, "r+");
  try {
    const head = Buffer.alloc(16);
    readSync(fd, head, 0, 16, 0);
    const headerPickleSize = head.readUInt32LE(4);
    const jsonLength = head.readUInt32LE(12);
    const json = Buffer.alloc(jsonLength);
    readSync(fd, json, 0, jsonLength, 16);
    const header = JSON.parse(json.toString("utf8")) as Entry;
    const { offset, size } = locate(header, path);
    if (size === 0) throw new Error(`${path} is empty`);
    const position = 8 + headerPickleSize + offset + Math.floor(size / 2);
    const byte = Buffer.alloc(1);
    readSync(fd, byte, 0, 1, position);
    byte[0] ^= 0xff;
    writeSync(fd, byte, 0, 1, position);
    return position;
  } finally {
    closeSync(fd);
  }
}

if (import.meta.main) {
  const [archive, path = "dist-electron/main.js"] = process.argv.slice(2);
  if (!archive) {
    console.error("usage: bun scripts/tamper-asar.ts <app.asar> [file inside]");
    process.exit(2);
  }
  const position = tamper(archive, path);
  console.log(`Changed the byte at ${position} of ${archive} (inside ${path}).`);
}
