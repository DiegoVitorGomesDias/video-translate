// Gera ícones PNG (sem dependências): quadrado verde-água arredondado com um balão
// de legenda branco. Usado pela extensão (public/icon) e pelo PWA (pwa/public/icons).
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// Desenho em coordenadas 0..1: fundo arredondado + balão com duas "linhas" de legenda.
function pixel(u, v, maskable) {
  const inRound = (x, y, x0, y0, x1, y1, r) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.max(x0 + r, Math.min(x, x1 - r)), cy = Math.max(y0 + r, Math.min(y, y1 - r));
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  const bg = maskable ? true : inRound(u, v, 0, 0, 1, 1, 0.22);
  if (!bg) return [0, 0, 0, 0];
  const p = maskable ? 0.14 : 0.0; // área segura
  const s = (t) => p + t * (1 - 2 * p);
  if (inRound(u, v, s(0.16), s(0.24), s(0.84), s(0.66), 0.08)) {
    // linhas de texto dentro do balão
    if ((v > s(0.34) && v < s(0.42) && u > s(0.26) && u < s(0.74)) || (v > s(0.48) && v < s(0.56) && u > s(0.26) && u < s(0.6))) return [10, 124, 106, 255];
    return [255, 255, 255, 255];
  }
  // rabinho do balão
  if (u > s(0.3) && u < s(0.44) && v >= s(0.66) && v < s(0.78) && (u - s(0.3)) > (v - s(0.66)) * 1.1) return [255, 255, 255, 255];
  return [10, 124, 106, 255];
}
const targets = [
  [join(root, 'public', 'icon'), [16, 32, 48, 128], false],
  [join(root, 'pwa', 'public', 'icons'), [192, 512], false],
];
for (const [dir, sizes, maskable] of targets) {
  mkdirSync(dir, { recursive: true });
  for (const size of sizes) writeFileSync(join(dir, dir.endsWith('icons') ? `icon-${size}.png` : `${size}.png`), png(size, (u, v) => pixel(u, v, maskable)));
}
writeFileSync(join(root, 'pwa', 'public', 'icons', 'icon-512-maskable.png'), png(512, (u, v) => pixel(u, v, true)));
console.log('[gen-icons] ícones gerados em public/icon e pwa/public/icons');
