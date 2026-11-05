/**
 * The pixel size of an image from its header, without decoding it: PNG,
 * JPEG, GIF, BMP and TIFF. Null for anything else or a damaged header.
 */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = bytes.length;
  const ok = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : null);
  // PNG: the IHDR chunk follows the signature.
  if (n >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return ok(view.getUint32(16), view.getUint32(20));
  }
  // GIF: the logical screen size.
  if (n >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return ok(view.getUint16(6, true), view.getUint16(8, true));
  }
  // BMP: the info header (the height is negative for a top-down image).
  if (n >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return ok(Math.abs(view.getInt32(18, true)), Math.abs(view.getInt32(22, true)));
  }
  // JPEG: the first start-of-frame segment.
  if (n >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < n) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      const length = view.getUint16(i + 2);
      const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (sof) return ok(view.getUint16(i + 7), view.getUint16(i + 5));
      i += 2 + length;
    }
    return null;
  }
  // TIFF: the first image file directory's width and length tags.
  if (n >= 8 && ((bytes[0] === 0x49 && bytes[1] === 0x49) || (bytes[0] === 0x4d && bytes[1] === 0x4d))) {
    const le = bytes[0] === 0x49;
    const ifd = view.getUint32(4, le);
    if (ifd + 2 > n) return null;
    const count = view.getUint16(ifd, le);
    let width = 0;
    let height = 0;
    for (let k = 0; k < count; k++) {
      const at = ifd + 2 + k * 12;
      if (at + 12 > n) break;
      const tag = view.getUint16(at, le);
      const type = view.getUint16(at + 2, le);
      const value = type === 3 ? view.getUint16(at + 8, le) : view.getUint32(at + 8, le);
      if (tag === 256) width = value;
      if (tag === 257) height = value;
    }
    return ok(width, height);
  }
  return null;
}
