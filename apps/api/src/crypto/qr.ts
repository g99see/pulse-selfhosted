// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Минимальный QR-энкодер (ТЗ §6) без зависимостей: byte-режим, версии 1–10,
 * уровни коррекции L/M/Q/H, автоматический подбор версии и маски.
 *
 * Нужен только для того, чтобы показать otpauth:// в QR-коде при настройке
 * 2FA; рядом всегда отдаём секрет и URI для ручного ввода. Алгоритм следует
 * ISO/IEC 18004, эталонные матрицы сверены с независимой реализацией.
 */
export type ErrorCorrection = 'L' | 'M' | 'Q' | 'H';

export interface QrOptions {
  errorCorrection?: ErrorCorrection;
  /** Явная маска 0–7 (для тестов); иначе выбирается по штрафу. */
  mask?: number;
  /** Максимальная версия (по умолчанию 10). */
  maxVersion?: number;
  margin?: number;
  scale?: number;
}

export interface QrResult {
  version: number;
  size: number;
  mask: number;
  errorCorrection: ErrorCorrection;
  modules: number[][];
}

/** Блоки данных и EC по (уровень, версия): [кол-во блоков, всего, данных]. */
const EC_BLOCKS: Record<ErrorCorrection, Record<number, ReadonlyArray<readonly [number, number, number]>>> = {
  L: {
    1: [[1, 26, 19]],
    2: [[1, 44, 34]],
    3: [[1, 70, 55]],
    4: [[1, 100, 80]],
    5: [[1, 134, 108]],
    6: [[2, 86, 68]],
    7: [[2, 98, 78]],
    8: [[2, 121, 97]],
    9: [[2, 146, 116]],
    10: [
      [2, 86, 68],
      [2, 87, 69],
    ],
  },
  M: {
    1: [[1, 26, 16]],
    2: [[1, 44, 28]],
    3: [[1, 70, 44]],
    4: [[2, 50, 32]],
    5: [[2, 67, 43]],
    6: [[4, 43, 27]],
    7: [[4, 49, 31]],
    8: [
      [2, 60, 38],
      [2, 61, 39],
    ],
    9: [
      [3, 58, 36],
      [2, 59, 37],
    ],
    10: [
      [4, 69, 43],
      [1, 70, 44],
    ],
  },
  Q: {
    1: [[1, 26, 13]],
    2: [[1, 44, 22]],
    3: [[2, 35, 17]],
    4: [[2, 50, 24]],
    5: [
      [2, 33, 15],
      [2, 34, 16],
    ],
    6: [[4, 43, 19]],
    7: [
      [2, 32, 14],
      [4, 33, 15],
    ],
    8: [
      [4, 40, 18],
      [2, 41, 19],
    ],
    9: [
      [4, 36, 16],
      [4, 37, 17],
    ],
    10: [
      [6, 43, 19],
      [2, 44, 20],
    ],
  },
  H: {
    1: [[1, 26, 9]],
    2: [[1, 44, 16]],
    3: [
      [2, 35, 13],
    ],
    4: [[4, 25, 9]],
    5: [
      [2, 33, 11],
      [2, 34, 12],
    ],
    6: [[4, 43, 15]],
    7: [
      [4, 39, 13],
      [1, 40, 14],
    ],
    8: [
      [4, 40, 14],
      [2, 41, 15],
    ],
    9: [
      [4, 36, 12],
      [4, 37, 13],
    ],
    10: [
      [6, 43, 15],
      [2, 44, 16],
    ],
  },
};

const ALIGNMENT: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

const EC_FORMAT_BITS: Record<ErrorCorrection, number> = { L: 1, M: 0, Q: 3, H: 2 };

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

// --- Галуа GF(256) для кодов Рида–Соломона (полином 0x11D). ---
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    GF_EXP[index] = value;
    GF_LOG[value] = index;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let index = 255; index < 512; index += 1) GF_EXP[index] = GF_EXP[index - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function generatorPoly(degree: number): number[] {
  let poly = [1];
  for (let index = 0; index < degree; index += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let i = 0; i < poly.length; i += 1) {
      next[i] ^= poly[i];
      next[i + 1] ^= gfMul(poly[i], GF_EXP[index]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: number[], ecLength: number): number[] {
  const generator = generatorPoly(ecLength);
  const remainder = data.concat(new Array<number>(ecLength).fill(0));
  for (let i = 0; i < data.length; i += 1) {
    const coefficient = remainder[i];
    if (coefficient === 0) continue;
    for (let j = 1; j < generator.length; j += 1) {
      remainder[i + j] ^= gfMul(generator[j], coefficient);
    }
  }
  return remainder.slice(data.length);
}

class BitBuffer {
  readonly bits: number[] = [];

  append(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) {
      this.bits.push((value >>> i) & 1);
    }
  }
}

function toCodewords(bits: number[]): number[] {
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (bits[i + j] ?? 0);
    codewords.push(byte);
  }
  return codewords;
}

function dataCapacity(level: ErrorCorrection, version: number): number {
  return EC_BLOCKS[level][version].reduce((sum, [count, , data]) => sum + count * data, 0);
}

function charCountBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

function requiredBits(byteLength: number, version: number): number {
  return 4 + charCountBits(version) + byteLength * 8;
}

function chooseVersion(byteLength: number, level: ErrorCorrection, maxVersion: number): number {
  for (let version = 1; version <= maxVersion; version += 1) {
    if (requiredBits(byteLength, version) <= dataCapacity(level, version) * 8) return version;
  }
  throw new Error('Данные не помещаются в QR-код версии до ' + maxVersion);
}

function buildCodewords(data: Uint8Array, version: number, level: ErrorCorrection): number[] {
  const capacity = dataCapacity(level, version);
  const buffer = new BitBuffer();
  buffer.append(0b0100, 4); // byte mode
  buffer.append(data.length, charCountBits(version));
  for (const byte of data) buffer.append(byte, 8);

  // Терминатор не длиннее 4 бит и не за пределами ёмкости.
  const capacityBits = capacity * 8;
  for (let i = 0; i < 4 && buffer.bits.length < capacityBits; i += 1) buffer.bits.push(0);
  while (buffer.bits.length % 8 !== 0) buffer.bits.push(0);

  const codewords = toCodewords(buffer.bits);
  const pads = [0xec, 0x11];
  for (let index = 0; codewords.length < capacity; index += 1) {
    codewords.push(pads[index % 2]);
  }

  // Блоки: данные + EC, затем чередование.
  const blocks: { data: number[]; ec: number[] }[] = [];
  let offset = 0;
  for (const [count, total, dataLength] of EC_BLOCKS[level][version]) {
    for (let block = 0; block < count; block += 1) {
      const blockData = codewords.slice(offset, offset + dataLength);
      offset += dataLength;
      blocks.push({ data: blockData, ec: rsEncode(blockData, total - dataLength) });
    }
  }

  const result: number[] = [];
  const maxData = Math.max(...blocks.map((block) => block.data.length));
  for (let i = 0; i < maxData; i += 1) {
    for (const block of blocks) {
      if (i < block.data.length) result.push(block.data[i]);
    }
  }
  const maxEc = Math.max(...blocks.map((block) => block.ec.length));
  for (let i = 0; i < maxEc; i += 1) {
    for (const block of blocks) {
      if (i < block.ec.length) result.push(block.ec[i]);
    }
  }
  return result;
}

function newMatrix(size: number): { modules: number[][]; reserved: boolean[][] } {
  return {
    modules: Array.from({ length: size }, () => new Array<number>(size).fill(0)),
    reserved: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
  };
}

function drawFunction(
  modules: number[][],
  reserved: boolean[][],
  row: number,
  col: number,
  dark: boolean,
): void {
  modules[row][col] = dark ? 1 : 0;
  reserved[row][col] = true;
}

function drawFinder(modules: number[][], reserved: boolean[][], centerRow: number, centerCol: number): void {
  const size = modules.length;
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const row = centerRow + dy;
      const col = centerCol + dx;
      if (row < 0 || row >= size || col < 0 || col >= size) continue;
      const distance = Math.max(Math.abs(dy), Math.abs(dx));
      drawFunction(modules, reserved, row, col, distance !== 2 && distance !== 4);
    }
  }
}

function drawAlignment(modules: number[][], reserved: boolean[][], centerRow: number, centerCol: number): void {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const distance = Math.max(Math.abs(dy), Math.abs(dx));
      drawFunction(modules, reserved, centerRow + dy, centerCol + dx, distance !== 1);
    }
  }
}

function drawFunctionPatterns(modules: number[][], reserved: boolean[][], version: number): void {
  const size = modules.length;

  // Тайминг-паттерны.
  for (let i = 8; i < size - 8; i += 1) {
    const dark = i % 2 === 0;
    drawFunction(modules, reserved, 6, i, dark);
    drawFunction(modules, reserved, i, 6, dark);
  }

  // Угловые «глаза» с разделителями.
  drawFinder(modules, reserved, 3, 3);
  drawFinder(modules, reserved, 3, size - 4);
  drawFinder(modules, reserved, size - 4, 3);

  // Выравнивающие паттерны, кроме пересечений с «глазами».
  const positions = ALIGNMENT[version];
  for (const row of positions) {
    for (const col of positions) {
      const atTopLeft = row <= 7 && col <= 7;
      const atTopRight = row <= 7 && col >= size - 8;
      const atBottomLeft = row >= size - 8 && col <= 7;
      if (atTopLeft || atTopRight || atBottomLeft) continue;
      drawAlignment(modules, reserved, row, col);
    }
  }

  // Резерв под формат (два прохода) и тёмный модуль.
  for (let i = 0; i <= 8; i += 1) {
    if (!reserved[8][i]) reserved[8][i] = true;
    if (!reserved[i][8]) reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i += 1) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }
  reserved[size - 8][8] = true;

  // Информация о версии (7+).
  if (version >= 7) {
    let remainder = version;
    for (let i = 0; i < 12; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const bits = (version << 12) | remainder;
    for (let i = 0; i < 18; i += 1) {
      const bit = ((bits >> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      drawFunction(modules, reserved, b, a, bit);
      drawFunction(modules, reserved, a, b, bit);
    }
  }
}

function drawCodewords(modules: number[][], reserved: boolean[][], codewords: number[]): void {
  const size = modules.length;
  let bitIndex = 0;
  const totalBits = codewords.length * 8;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical += 1) {
      for (let j = 0; j < 2; j += 1) {
        const col = right - j;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? size - 1 - vertical : vertical;
        if (!reserved[row][col] && bitIndex < totalBits) {
          modules[row][col] = (codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1;
          bitIndex += 1;
        }
      }
    }
  }
}

function maskBit(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

function applyMask(modules: number[][], reserved: boolean[][], mask: number): void {
  const size = modules.length;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (!reserved[row][col] && maskBit(mask, row, col)) {
        modules[row][col] ^= 1;
      }
    }
  }
}

function drawFormatBits(modules: number[][], reserved: boolean[][], level: ErrorCorrection, mask: number): void {
  const size = modules.length;
  const data = (EC_FORMAT_BITS[level] << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  const bits = ((data << 10) | remainder) ^ 0x5412;
  const bit = (index: number): boolean => ((bits >> index) & 1) === 1;

  for (let i = 0; i <= 5; i += 1) drawFunction(modules, reserved, i, 8, bit(i));
  drawFunction(modules, reserved, 7, 8, bit(6));
  drawFunction(modules, reserved, 8, 8, bit(7));
  drawFunction(modules, reserved, 8, 7, bit(8));
  for (let i = 9; i < 15; i += 1) drawFunction(modules, reserved, 8, 14 - i, bit(i));

  for (let i = 0; i < 8; i += 1) drawFunction(modules, reserved, 8, size - 1 - i, bit(i));
  for (let i = 8; i < 15; i += 1) drawFunction(modules, reserved, size - 15 + i, 8, bit(i));
  drawFunction(modules, reserved, size - 8, 8, true);
}

function penalty(modules: number[][]): number {
  const size = modules.length;
  let score = 0;

  // N1: серии одного цвета в строках и столбцах.
  for (let row = 0; row < size; row += 1) {
    let run = 1;
    for (let col = 1; col < size; col += 1) {
      if (modules[row][col] === modules[row][col - 1]) {
        run += 1;
      } else {
        if (run >= 5) score += PENALTY_N1 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) score += PENALTY_N1 + (run - 5);
  }
  for (let col = 0; col < size; col += 1) {
    let run = 1;
    for (let row = 1; row < size; row += 1) {
      if (modules[row][col] === modules[row - 1][col]) {
        run += 1;
      } else {
        if (run >= 5) score += PENALTY_N1 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) score += PENALTY_N1 + (run - 5);
  }

  // N2: блоки 2×2 одного цвета.
  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const value = modules[row][col];
      if (
        value === modules[row][col + 1] &&
        value === modules[row + 1][col] &&
        value === modules[row + 1][col + 1]
      ) {
        score += PENALTY_N2;
      }
    }
  }

  // N3: «глазоподобные» последовательности 10111010000 / 00001011101.
  const patterns = ['10111010000', '00001011101'];
  const lines: number[][] = [];
  for (let i = 0; i < size; i += 1) {
    lines.push(modules[i]);
    lines.push(modules.map((row) => row[i]));
  }
  for (const line of lines) {
    const text = line.join('');
    for (const pattern of patterns) {
      let from = text.indexOf(pattern);
      while (from !== -1) {
        score += PENALTY_N3;
        from = text.indexOf(pattern, from + 1);
      }
    }
  }

  // N4: баланс тёмных и светлых модулей.
  let dark = 0;
  for (const row of modules) for (const cell of row) dark += cell;
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  score += Math.max(0, k) * PENALTY_N4;

  return score;
}

function render(
  size: number,
  level: ErrorCorrection,
  version: number,
  codewords: number[],
  mask: number,
): number[][] {
  const { modules, reserved } = newMatrix(size);
  drawFunctionPatterns(modules, reserved, version);
  drawCodewords(modules, reserved, codewords);
  applyMask(modules, reserved, mask);
  drawFormatBits(modules, reserved, level, mask);
  return modules;
}

/** Кодирует полезную нагрузку в матрицу QR. */
export function encodeQr(data: string, options: QrOptions = {}): QrResult {
  const level = options.errorCorrection ?? 'M';
  const maxVersion = options.maxVersion ?? 10;
  const bytes = new TextEncoder().encode(data);
  const version = chooseVersion(bytes.length, level, maxVersion);
  const size = 17 + version * 4;
  const codewords = buildCodewords(bytes, version, level);

  if (options.mask !== undefined) {
    const mask = options.mask;
    return { version, size, mask, errorCorrection: level, modules: render(size, level, version, codewords, mask) };
  }

  let bestMask = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask += 1) {
    const modules = render(size, level, version, codewords, mask);
    const score = penalty(modules);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
    }
  }
  return {
    version,
    size,
    mask: bestMask,
    errorCorrection: level,
    modules: render(size, level, version, codewords, bestMask),
  };
}

/** SVG с матрицей (чёрные модули на белом фоне, quiet zone 4 по умолчанию). */
export function qrToSvg(modules: number[][], options: { margin?: number; scale?: number } = {}): string {
  const margin = options.margin ?? 4;
  const scale = options.scale ?? 1;
  const size = modules.length;
  const view = size + margin * 2;
  let path = '';
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (modules[row][col]) path += `M${col + margin} ${row + margin}h1v1h-1z`;
    }
  }
  const dimension = view * scale;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${dimension}" height="${dimension}" ` +
    `viewBox="0 0 ${view} ${view}" shape-rendering="crispEdges" role="img" aria-label="QR">` +
    `<rect width="${view}" height="${view}" fill="#ffffff"/>` +
    `<path d="${path}" fill="#000000"/></svg>`
  );
}

/** data-URL с SVG — готов для <img src>. */
export function qrDataUrl(data: string, options: QrOptions = {}): string {
  const qr = encodeQr(data, options);
  const svg = qrToSvg(qr.modules, { margin: options.margin, scale: options.scale });
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}
