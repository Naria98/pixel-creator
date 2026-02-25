/**
 * 디더링 3종: Bayer (Ordered) / Floyd-Steinberg / Atkinson
 */

import { rgbToLab, labDistance, labToRgb } from './kmeans.js';

// ─── 팔레트 최근접 탐색 헬퍼 ─────────────────────────────────────────────────

function nearestColor(r, g, b, palette, labPalette) {
  const lab = rgbToLab(
    Math.max(0, Math.min(255, r)),
    Math.max(0, Math.min(255, g)),
    Math.max(0, Math.min(255, b))
  );
  let minD = Infinity, best = palette[0];
  for (let i = 0; i < labPalette.length; i++) {
    const d = labDistance(lab, labPalette[i]);
    if (d < minD) { minD = d; best = palette[i]; }
  }
  return best;
}

// ─── Bayer Ordered Dithering ─────────────────────────────────────────────────

const BAYER_4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

export function bayerDither(imageData, palette) {
  const { data, width, height } = imageData;
  const labPalette = palette.map(c => rgbToLab(c.r, c.g, c.b));
  const result = new Uint8ClampedArray(data.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 128) { result[i + 3] = 0; continue; }

      const threshold = (BAYER_4[(y % 4) * 4 + (x % 4)] / 16 - 0.5) * 32;
      const nr = data[i] + threshold;
      const ng = data[i + 1] + threshold;
      const nb = data[i + 2] + threshold;

      const c = nearestColor(nr, ng, nb, palette, labPalette);
      result[i] = c.r; result[i + 1] = c.g; result[i + 2] = c.b; result[i + 3] = 255;
    }
  }

  return new ImageData(result, width, height);
}

// ─── Floyd-Steinberg Dithering ────────────────────────────────────────────────

export function floydSteinbergDither(imageData, palette) {
  const { data, width, height } = imageData;
  const labPalette = palette.map(c => rgbToLab(c.r, c.g, c.b));
  const result = new Uint8ClampedArray(data.length);

  // 오차 버퍼 (Float32 for precision)
  const errR = new Float32Array(width * height);
  const errG = new Float32Array(width * height);
  const errB = new Float32Array(width * height);

  for (let i = 0; i < width * height; i++) {
    errR[i] = data[i * 4];
    errG[i] = data[i * 4 + 1];
    errB[i] = data[i * 4 + 2];
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const i = idx * 4;

      if (data[i + 3] < 128) { result[i + 3] = 0; continue; }

      const oldR = errR[idx], oldG = errG[idx], oldB = errB[idx];
      const c = nearestColor(oldR, oldG, oldB, palette, labPalette);

      result[i] = c.r; result[i + 1] = c.g; result[i + 2] = c.b; result[i + 3] = 255;

      const er = oldR - c.r, eg = oldG - c.g, eb = oldB - c.b;

      const spread = (dx, dy, factor) => {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;
        const ni = ny * width + nx;
        errR[ni] += er * factor;
        errG[ni] += eg * factor;
        errB[ni] += eb * factor;
      };

      spread(1, 0, 7 / 16);
      spread(-1, 1, 3 / 16);
      spread(0, 1, 5 / 16);
      spread(1, 1, 1 / 16);
    }
  }

  return new ImageData(result, width, height);
}

// ─── Atkinson Dithering ───────────────────────────────────────────────────────

export function atkinsonDither(imageData, palette) {
  const { data, width, height } = imageData;
  const labPalette = palette.map(c => rgbToLab(c.r, c.g, c.b));
  const result = new Uint8ClampedArray(data.length);

  const errR = new Float32Array(width * height);
  const errG = new Float32Array(width * height);
  const errB = new Float32Array(width * height);

  for (let i = 0; i < width * height; i++) {
    errR[i] = data[i * 4];
    errG[i] = data[i * 4 + 1];
    errB[i] = data[i * 4 + 2];
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const i = idx * 4;

      if (data[i + 3] < 128) { result[i + 3] = 0; continue; }

      const oldR = errR[idx], oldG = errG[idx], oldB = errB[idx];
      const c = nearestColor(oldR, oldG, oldB, palette, labPalette);

      result[i] = c.r; result[i + 1] = c.g; result[i + 2] = c.b; result[i + 3] = 255;

      // Atkinson: 오차의 6/8만 분산 (더 선명한 결과)
      const er = (oldR - c.r) / 8;
      const eg = (oldG - c.g) / 8;
      const eb = (oldB - c.b) / 8;

      const spread = (dx, dy) => {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;
        const ni = ny * width + nx;
        errR[ni] += er;
        errG[ni] += eg;
        errB[ni] += eb;
      };

      spread(1, 0); spread(2, 0);
      spread(-1, 1); spread(0, 1); spread(1, 1);
      spread(0, 2);
    }
  }

  return new ImageData(result, width, height);
}

// ─── 디더링 통합 인터페이스 ────────────────────────────────────────────────────

export function applyDithering(imageData, palette, method) {
  switch (method) {
    case 'bayer': return bayerDither(imageData, palette);
    case 'atkinson': return atkinsonDither(imageData, palette);
    case 'floyd': return floydSteinbergDither(imageData, palette);
    default: return imageData;
  }
}
