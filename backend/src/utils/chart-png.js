// Generación de gráficos PNG sin dependencias nativas (P2 #20).
// Se dibuja rasterizando en un búfer RGB y codificando PNG con zlib de Node.
// Las etiquetas numéricas usan una fuente bitmap 5x7 mínima (dígitos, punto y guion).
import zlib from 'node:zlib';

// --- Codificación PNG -------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgb) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filtro: none
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// --- Lienzo simple ----------------------------------------------------------
const FONT = {
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

class Canvas {
  constructor(width, height) {
    this.w = width;
    this.h = height;
    this.buf = Buffer.alloc(width * height * 3, 0xff);
  }

  pixel(x, y, [r, g, b]) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.buf[i] = r;
    this.buf[i + 1] = g;
    this.buf[i + 2] = b;
  }

  rect(x0, y0, w, h, color) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.pixel(x, y, color);
  }

  hLine(x0, x1, y, color, thickness = 1) {
    for (let t = 0; t < thickness; t++) for (let x = x0; x <= x1; x++) this.pixel(x, y + t, color);
  }

  line(x0, y0, x1, y1, color, thickness = 2) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    for (;;) {
      for (let tx = 0; tx < thickness; tx++) for (let ty = 0; ty < thickness; ty++) this.pixel(x + tx, y + ty, color);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }

  text(value, x, y, color, scale = 2) {
    let cx = x;
    for (const ch of String(value)) {
      const glyph = FONT[ch] || FONT[' '];
      for (let gy = 0; gy < 7; gy++) {
        for (let gx = 0; gx < 5; gx++) {
          if (glyph[gy][gx] === '1') {
            for (let sy = 0; sy < scale; sy++)
              for (let sx = 0; sx < scale; sx++) this.pixel(cx + gx * scale + sx, y + gy * scale + sy, color);
          }
        }
      }
      cx += 6 * scale;
    }
  }
}

function fmtAxis(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '-';
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

// Serie temporal: [{ x: etiqueta|null, y: número }]. Devuelve Buffer PNG.
export function renderLineChart(points, { width = 1400, height = 420, color = [8, 121, 104], label = '' } = {}) {
  const canvas = new Canvas(width, height);
  const muted = [140, 156, 150];
  const light = [224, 233, 229];
  const dark = [24, 49, 43];

  const padLeft = 110;
  const padRight = 40;
  const padTop = 46;
  const padBottom = 46;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const values = points.map((p) => Number(p.y)).filter((v) => Number.isFinite(v));
  if (!values.length) {
    canvas.rect(0, 0, width, height, [255, 255, 255]);
    canvas.text('Sin datos', padLeft, padTop, muted, 3);
    return encodePng(width, height, canvas.buf);
  }
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.08;
  min -= pad;
  max += pad;

  const yFor = (v) => padTop + plotH - ((v - min) / (max - min)) * plotH;
  const xFor = (i) => (points.length > 1 ? padLeft + (i / (points.length - 1)) * plotW : padLeft + plotW / 2);

  // Rejilla horizontal (4 niveles) con etiquetas de eje Y.
  for (let g = 0; g <= 4; g++) {
    const value = min + ((max - min) * g) / 4;
    const y = Math.round(yFor(value));
    canvas.hLine(padLeft, padLeft + plotW, y, light, 1);
    canvas.text(fmtAxis(value), 8, y - 7, muted, 2);
  }
  // Ejes.
  canvas.line(padLeft, padTop, padLeft, padTop + plotH, muted, 2);
  canvas.line(padLeft, padTop + plotH, padLeft + plotW, padTop + plotH, muted, 2);

  // Área + línea.
  const coords = points.map((p, i) => [Math.round(xFor(i)), Math.round(yFor(Number(p.y)))]);
  for (let i = 1; i < coords.length; i++) {
    canvas.line(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1], color, 3);
  }
  // Marcadores en los extremos.
  for (const [x, y] of [coords[0], coords[coords.length - 1]]) {
    canvas.rect(x - 3, y - 3, 6, 6, dark);
  }

  if (label) canvas.text(label, padLeft, 14, dark, 2);

  return encodePng(width, height, canvas.buf);
}
