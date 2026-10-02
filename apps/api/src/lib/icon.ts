import { crc32, deflateSync } from "node:zlib";

/**
 * The extension's icon (green rounded square with a white "DR"), drawn pixel by pixel and written as a PNG —
 * no image files or libraries. Sizes 16/32/48/128.
 */
const FONT: Record<string, string[]> = { // 5×7 glyphs
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
};

function png(w: number, h: number, rgba: Buffer) {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

export function iconPng(size: number): Buffer {
  const S = 8; // supersample for smooth corners
  const W = size * S, px = Buffer.alloc(size * size * 4);
  const green = [21, 128, 61], white = [255, 255, 255];
  const r = W * 0.22, scale = (W * 0.62) / 11; // "D R" = 5 + 1 + 5 columns
  const ox = (W - 11 * scale) / 2, oy = (W - 7 * scale) / 2;
  const glyphAt = (X: number, Y: number) => {
    const gx = Math.floor((X - ox) / scale), gy = Math.floor((Y - oy) / scale);
    if (gy < 0 || gy > 6) return false;
    if (gx >= 0 && gx < 5) return FONT.D[gy][gx] === "1";
    if (gx >= 6 && gx < 11) return FONT.R[gy][gx - 6] === "1";
    return false;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let inside = 0, text = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const X = x * S + sx + 0.5, Y = y * S + sy + 0.5;
      const dx = Math.max(r - X, 0, X - (W - r)), dy = Math.max(r - Y, 0, Y - (W - r));
      if (dx * dx + dy * dy <= r * r) { inside++; if (glyphAt(X, Y)) text++; }
    }
    const a = inside / (S * S), t = inside ? text / inside : 0, i = (y * size + x) * 4;
    for (let c = 0; c < 3; c++) px[i + c] = Math.round(green[c] * (1 - t) + white[c] * t);
    px[i + 3] = Math.round(a * 255);
  }
  return png(size, size, px);
}
