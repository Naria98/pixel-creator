/**
 * 픽셀아트 후처리: Anti-Aliasing / Selective Outlining / Lonely Pixel 제거 / Banding 방지
 * 자동 품질 감지 로직 포함 (Phase 7)
 */

import { rgbToLab, labDistance } from './kmeans.js';

// ─── 유틸 ─────────────────────────────────────────────────────────────────────

function getPixel(data, width, height, x, y) {
  if (x < 0 || x >= width || y < 0 || y >= height) return null;
  const i = (y * width + x) * 4;
  if (data[i + 3] === 0) return null;
  return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
}

function setPixel(data, width, x, y, r, g, b, a) {
  const i = (y * width + x) * 4;
  data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
}

function colorEqual(p1, p2) {
  return p1 && p2 && p1.r === p2.r && p1.g === p2.g && p1.b === p2.b;
}

function blendColor(p1, p2) {
  return {
    r: Math.round((p1.r + p2.r) / 2),
    g: Math.round((p1.g + p2.g) / 2),
    b: Math.round((p1.b + p2.b) / 2),
    a: 255,
  };
}

// ─── Anti-Aliasing ────────────────────────────────────────────────────────────

/**
 * 경계 픽셀에 중간색 삽입
 * - 45도 직선, 수직/수평선은 스킵 (의도적인 픽셀아트 선 보존)
 */
export function antiAlias(imageData) {
  const { data, width, height } = imageData;
  const result = new Uint8ClampedArray(data);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const center = getPixel(data, width, height, x, y);
      if (!center) continue;

      const n = getPixel(data, width, height, x, y - 1);
      const s = getPixel(data, width, height, x, y + 1);
      const e = getPixel(data, width, height, x + 1, y);
      const w = getPixel(data, width, height, x - 1, y);

      // 이미 수직/수평 선상이면 스킵
      if (n && s && colorEqual(n, center) && colorEqual(s, center)) continue;
      if (e && w && colorEqual(e, center) && colorEqual(w, center)) continue;

      // 45도 대각선 체크
      const ne = getPixel(data, width, height, x + 1, y - 1);
      const sw = getPixel(data, width, height, x - 1, y + 1);
      const nw = getPixel(data, width, height, x - 1, y - 1);
      const se = getPixel(data, width, height, x + 1, y + 1);

      if (ne && sw && colorEqual(ne, center) && colorEqual(sw, center)) continue;
      if (nw && se && colorEqual(nw, center) && colorEqual(se, center)) continue;

      // 경계 픽셀 탐지: 주변 4방향 중 2개 이상이 다른 색
      const neighbors = [n, s, e, w].filter(p => p && !colorEqual(p, center));
      if (neighbors.length >= 2) {
        const blend = blendColor(center, neighbors[0]);
        setPixel(result, width, x, y, blend.r, blend.g, blend.b, 255);
      }
    }
  }

  return new ImageData(result, width, height);
}

// ─── Selective Outlining ──────────────────────────────────────────────────────

/**
 * 외곽선 픽셀을 광원 방향 기반으로 어둡게 처리
 * lightDir: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
 */
export function selectiveOutline(imageData, lightDir = 'top-left') {
  const { data, width, height } = imageData;
  const result = new Uint8ClampedArray(data);

  const shadowDirs = {
    'top-left':    [{ dx: 1, dy: 0 }, { dx: 0, dy: 1 }],
    'top-right':   [{ dx: -1, dy: 0 }, { dx: 0, dy: 1 }],
    'bottom-left': [{ dx: 1, dy: 0 }, { dx: 0, dy: -1 }],
    'bottom-right':[{ dx: -1, dy: 0 }, { dx: 0, dy: -1 }],
  };

  const dirs = shadowDirs[lightDir] || shadowDirs['top-left'];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const center = getPixel(data, width, height, x, y);
      if (!center) continue;

      // 외곽선 픽셀인지 확인 (주변에 투명 픽셀이 있는 경우)
      let isOutline = false;
      for (const { dx, dy } of dirs) {
        const neighbor = getPixel(data, width, height, x + dx, y + dy);
        if (!neighbor) { isOutline = true; break; }
      }

      if (isOutline) {
        const darkR = Math.round(center.r * 0.5);
        const darkG = Math.round(center.g * 0.5);
        const darkB = Math.round(center.b * 0.5);
        setPixel(result, width, x, y, darkR, darkG, darkB, center.a);
      }
    }
  }

  return new ImageData(result, width, height);
}

// ─── Lonely Pixel 제거 ────────────────────────────────────────────────────────

/**
 * 주변 4방향이 모두 다른 색인 고립 픽셀을 주변 최다 색으로 대체
 */
export function removeLonelyPixels(imageData) {
  const { data, width, height } = imageData;
  const result = new Uint8ClampedArray(data);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const center = getPixel(data, width, height, x, y);
      if (!center) continue;

      const neighbors = [
        getPixel(data, width, height, x + 1, y),
        getPixel(data, width, height, x - 1, y),
        getPixel(data, width, height, x, y + 1),
        getPixel(data, width, height, x, y - 1),
      ].filter(Boolean);

      const sameCount = neighbors.filter(p => colorEqual(p, center)).length;
      if (sameCount === 0 && neighbors.length >= 2) {
        // 최다 색상으로 대체
        const dominant = findDominantColor(neighbors);
        setPixel(result, width, x, y, dominant.r, dominant.g, dominant.b, 255);
      }
    }
  }

  return new ImageData(result, width, height);
}

function findDominantColor(pixels) {
  const counts = {};
  for (const p of pixels) {
    const key = `${p.r},${p.g},${p.b}`;
    counts[key] = (counts[key] || { p, n: 0 });
    counts[key].n++;
  }
  let best = null, max = 0;
  for (const { p, n } of Object.values(counts)) {
    if (n > max) { max = n; best = p; }
  }
  return best || pixels[0];
}

// ─── Banding 방지 ─────────────────────────────────────────────────────────────

/**
 * 동일 명도 픽셀이 3개 이상 연속 시 중간 픽셀을 인접 명도로 조정
 */
export function preventBanding(imageData) {
  const { data, width, height } = imageData;
  const result = new Uint8ClampedArray(data);

  const getLuminance = p => p ? 0.299 * p.r + 0.587 * p.g + 0.114 * p.b : -1;
  const lumThreshold = 5;

  // 가로 방향 Banding 제거
  for (let y = 0; y < height; y++) {
    let runLen = 1, runStart = 0;
    for (let x = 1; x <= width; x++) {
      const prev = x > 0 ? getPixel(data, width, height, x - 1, y) : null;
      const curr = x < width ? getPixel(data, width, height, x, y) : null;

      const lumPrev = getLuminance(prev);
      const lumCurr = getLuminance(curr);

      if (curr && prev && Math.abs(lumPrev - lumCurr) < lumThreshold) {
        runLen++;
      } else {
        if (runLen >= 3) {
          // 가운데 픽셀을 살짝 어둡게
          const mid = Math.floor(runStart + runLen / 2);
          const mp = getPixel(data, width, height, mid, y);
          if (mp) {
            setPixel(result, width, mid, y,
              Math.max(0, mp.r - 10), Math.max(0, mp.g - 10), Math.max(0, mp.b - 10), mp.a);
          }
        }
        runLen = 1;
        runStart = x;
      }
    }
  }

  return new ImageData(result, width, height);
}

// ─── 품질 검사 (Phase 7) ──────────────────────────────────────────────────────

/**
 * 자동 품질 검사: Lonely Pixel, Banding, Dirty Line, 색상 초과
 */
export function qualityCheck(imageData, palette) {
  const { data, width, height } = imageData;
  const issues = { lonelyPixels: [], banding: [], dirtyLines: [], extraColors: [] };
  const getLum = p => p ? 0.299 * p.r + 0.587 * p.g + 0.114 * p.b : -1;
  const palSet = new Set(palette.map(c => `${c.r},${c.g},${c.b}`));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const center = getPixel(data, width, height, x, y);
      if (!center) continue;

      // 색상 초과 검사
      const key = `${center.r},${center.g},${center.b}`;
      if (palette.length > 0 && !palSet.has(key)) {
        issues.extraColors.push({ x, y });
      }

      // Lonely Pixel 검사
      const neighbors = [
        getPixel(data, width, height, x + 1, y),
        getPixel(data, width, height, x - 1, y),
        getPixel(data, width, height, x, y + 1),
        getPixel(data, width, height, x, y - 1),
      ].filter(Boolean);
      if (neighbors.length >= 2 && neighbors.every(p => !colorEqual(p, center))) {
        issues.lonelyPixels.push({ x, y });
      }
    }
  }

  // Banding 검사 (가로 3연속 동일 명도)
  for (let y = 0; y < height; y++) {
    let runLen = 1;
    for (let x = 1; x < width; x++) {
      const p1 = getPixel(data, width, height, x - 1, y);
      const p2 = getPixel(data, width, height, x, y);
      if (p1 && p2 && Math.abs(getLum(p1) - getLum(p2)) < 5) {
        runLen++;
        if (runLen >= 3) issues.banding.push({ x: x - runLen + 1, y, len: runLen });
      } else {
        runLen = 1;
      }
    }
  }

  return issues;
}
