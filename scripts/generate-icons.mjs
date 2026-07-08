import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(rootDir, "icons");
const docsAssetsDir = join(rootDir, "docs", "assets");
await mkdir(outDir, { recursive: true });
await mkdir(docsAssetsDir, { recursive: true });
await writeFile(join(outDir, "icon.svg"), makeIconSvg());
await writeFile(join(docsAssetsDir, "logo.svg"), makeLogoSvg());

for (const size of [16, 32, 48, 128]) {
  const png = makeIcon(size);
  await writeFile(join(outDir, `icon${size}.png`), png);
}

console.log(`Generated icons in ${outDir}`);

function makeIconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="TabRecap">
  <rect x="0" y="0" width="32" height="32" rx="9" fill="#1c1914"/>
  <rect x="6" y="6" width="8" height="8" rx="2.7" fill="#c9ff4a"/>
  <rect x="18" y="6" width="8" height="8" rx="2.7" fill="#1f55ff"/>
  <rect x="6" y="18" width="8" height="8" rx="2.7" fill="#d94a32"/>
  <rect x="18" y="18" width="8" height="8" rx="2.7" fill="#fffaf0" opacity="0.72"/>
</svg>
`;
}

function makeLogoSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 132" role="img" aria-label="TabRecap">
  <rect x="10" y="18" width="88" height="88" rx="24" fill="#1c1914"/>
  <rect x="29" y="37" width="20" height="20" rx="7" fill="#c9ff4a"/>
  <rect x="59" y="37" width="20" height="20" rx="7" fill="#1f55ff"/>
  <rect x="29" y="67" width="20" height="20" rx="7" fill="#d94a32"/>
  <rect x="59" y="67" width="20" height="20" rx="7" fill="#fffaf0" opacity="0.72"/>
  <text x="124" y="65" fill="#1c1914" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Avenir Next', 'Segoe UI', sans-serif" font-size="48" font-weight="900" letter-spacing="0">TabRecap</text>
  <text x="126" y="96" fill="#706755" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Avenir Next', 'Segoe UI', sans-serif" font-size="21" font-weight="750" letter-spacing="0">AI 标签整理与工作回顾</text>
</svg>
`;
}

function makeIcon(size) {
  const scale = size <= 32 ? 8 : 4;
  const canvasSize = size * scale;
  const rgba = Buffer.alloc(canvasSize * canvasSize * 4);

  const markSide = canvasSize;
  const markX = 0;
  const markY = 0;
  const markWidth = markSide;
  const markHeight = markSide;
  const markRadius = Math.round(size * 0.28) * scale;

  roundedRect(rgba, canvasSize, markX, markY, markWidth, markHeight, markRadius, [28, 25, 20, 255]);

  const chipSize = Math.round(size * 0.25) * scale;
  const chipRadius = Math.max(1, Math.round(size * 0.084)) * scale;
  const chipGap = Math.round(size * 0.125) * scale;
  const chipX1 = Math.round((canvasSize - chipSize * 2 - chipGap) / 2);
  const chipX2 = chipX1 + chipSize + chipGap;
  const chipY1 = chipX1;
  const chipY2 = chipX2;

  roundedRect(rgba, canvasSize, chipX1, chipY1, chipSize, chipSize, chipRadius, [201, 255, 74, 255]);
  roundedRect(rgba, canvasSize, chipX2, chipY1, chipSize, chipSize, chipRadius, [31, 85, 255, 255]);
  roundedRect(rgba, canvasSize, chipX1, chipY2, chipSize, chipSize, chipRadius, [217, 74, 50, 255]);
  roundedRect(rgba, canvasSize, chipX2, chipY2, chipSize, chipSize, chipRadius, [255, 250, 240, 184]);

  const output = downsample(rgba, canvasSize, size, scale);

  const pixels = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    pixels[rowStart] = 0;
    output.copy(pixels, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  const chunks = [
    chunk("IHDR", concatUInt32(size, size, Buffer.from([8, 6, 0, 0, 0]))),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0))
  ];
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]);
}

function roundedRect(buffer, size, x, y, width, height, radius, color) {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) {
      const dx = Math.max(x + radius - xx, 0, xx - (x + width - radius - 1));
      const dy = Math.max(y + radius - yy, 0, yy - (y + height - radius - 1));
      if (dx * dx + dy * dy <= radius * radius) setPixel(buffer, size, xx, yy, color);
    }
  }
}

function downsample(source, sourceSize, targetSize, scale) {
  const target = Buffer.alloc(targetSize * targetSize * 4);
  const samples = scale * scale;
  for (let y = 0; y < targetSize; y += 1) {
    for (let x = 0; x < targetSize; x += 1) {
      const sum = [0, 0, 0, 0];
      for (let yy = 0; yy < scale; yy += 1) {
        for (let xx = 0; xx < scale; xx += 1) {
          const offset = ((y * scale + yy) * sourceSize + x * scale + xx) * 4;
          sum[0] += source[offset];
          sum[1] += source[offset + 1];
          sum[2] += source[offset + 2];
          sum[3] += source[offset + 3];
        }
      }
      const targetOffset = (y * targetSize + x) * 4;
      target[targetOffset] = Math.round(sum[0] / samples);
      target[targetOffset + 1] = Math.round(sum[1] / samples);
      target[targetOffset + 2] = Math.round(sum[2] / samples);
      target[targetOffset + 3] = Math.round(sum[3] / samples);
    }
  }
  return target;
}

function setPixel(buffer, size, x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const offset = (y * size + x) * 4;
  buffer[offset] = color[0];
  buffer[offset + 1] = color[1];
  buffer[offset + 2] = color[2];
  buffer[offset + 3] = color[3];
}

function concatUInt32(width, height, rest) {
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(width, 0);
  buffer.writeUInt32BE(height, 4);
  return Buffer.concat([buffer, rest]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
