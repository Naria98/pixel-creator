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

/** 25% 약한 혼합 — 라인 두께 증가를 막기 위해 사용 */
function blendColorWeak(p1, p2) {
  return {
    r: Math.round(p1.r * 0.75 + p2.r * 0.25),
    g: Math.round(p1.g * 0.75 + p2.g * 0.25),
    b: Math.round(p1.b * 0.75 + p2.b * 0.25),
    a: 255,
  };
}

// ─── Anti-Aliasing ────────────────────────────────────────────────────────────

/**
 * 대각선 계단(staircase) 전환만 부드럽게 처리 — 라인 두께는 보존
 *
 * 개선 포인트:
 *  - 기존: 4방향 중 2개 이상이 다르면 50% 혼합 → 직선·외곽선도 번짐
 *  - 변경: 정확히 2방향이 다르고 서로 마주보지 않는 경우(=대각 코너)만 25% 혼합
 *    · N+S 또는 E+W 방향이 다른 경우 → 직선 경계 → 스킵
 *    · 45도 연속 대각선 → 스킵
 *    · 나머지 코너 패턴만 약하게 블렌딩
 */
export function antiAlias(imageData) {
  const { data, width, height } = imageData;

  // 소형 이미지(128px 미만)는 AA 스킵 — 작은 픽셀아트에서는 날카로운 엣지가 의도에 맞음.
  // 픽셀 하나가 차지하는 비중이 클수록 25% 블렌딩도 굵어보이는 현상이 생김.
  if (width < 128 || height < 128) return imageData;

  const result = new Uint8ClampedArray(data);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const center = getPixel(data, width, height, x, y);
      if (!center) continue;

      const n = getPixel(data, width, height, x,     y - 1);
      const s = getPixel(data, width, height, x,     y + 1);
      const e = getPixel(data, width, height, x + 1, y);
      const w = getPixel(data, width, height, x - 1, y);

      const nDiff = n && !colorEqual(n, center);
      const sDiff = s && !colorEqual(s, center);
      const eDiff = e && !colorEqual(e, center);
      const wDiff = w && !colorEqual(w, center);
      const diffCount = [nDiff, sDiff, eDiff, wDiff].filter(Boolean).length;

      // 대각 코너 패턴만 처리: 정확히 두 방향, 마주보지 않아야 함
      if (diffCount !== 2) continue;
      if (nDiff && sDiff) continue; // 수평 경계선 (직선) → 스킵
      if (eDiff && wDiff) continue; // 수직 경계선 (직선) → 스킵

      // 45도 연속 대각선 보존
      const ne = getPixel(data, width, height, x + 1, y - 1);
      const sw = getPixel(data, width, height, x - 1, y + 1);
      const nw = getPixel(data, width, height, x - 1, y - 1);
      const se = getPixel(data, width, height, x + 1, y + 1);
      if (ne && sw && colorEqual(ne, center) && colorEqual(sw, center)) continue;
      if (nw && se && colorEqual(nw, center) && colorEqual(se, center)) continue;

      // 이웃한 두 외부 픽셀 중 첫 번째로 25% 약하게 혼합
      const foreign = nDiff ? n : sDiff ? s : eDiff ? e : w;
      const blend = blendColorWeak(center, foreign);
      setPixel(result, width, x, y, blend.r, blend.g, blend.b, 255);
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
        // 주변보다 20+ 어두운 픽셀은 의도된 외곽선 → 보존 (극소형 출력에서 약한 대비도 보호)
        const centerLum = 0.299 * center.r + 0.587 * center.g + 0.114 * center.b;
        const avgNeighborLum = neighbors.reduce(
          (s, p) => s + 0.299 * p.r + 0.587 * p.g + 0.114 * p.b, 0
        ) / neighbors.length;
        if (avgNeighborLum - centerLum > 20) continue;

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

// ─── 외곽선 씨닝 (Outline Thinning) ──────────────────────────────────────────

/**
 * 2px 이상 두꺼운 외곽선을 1px로 얇게 만드는 후처리.
 *
 * 알고리즘:
 *  1. 각 픽셀이 "외곽선"인지 판별 (주변 밝은 픽셀보다 lumDiff 이상 어두운 픽셀)
 *  2. 외곽선 픽셀 중 수평/수직으로 인접한 외곽선 픽셀이 있으면 "두꺼운 외곽선"
 *  3. 두꺼운 외곽선의 "안쪽" 픽셀(밝은 영역으로부터 먼 쪽)을 주변 밝은 색으로 대체
 *
 * 소형 출력(32-128px)에서 다운샘플링 시 번진 외곽선을 정리하는 데 효과적.
 */
export function thinOutlines(imageData) {
  const { data, width, height } = imageData;

  // 소형 이미지(128px 이하)에서만 적용 — 큰 이미지에서는 두꺼운 외곽선이 드묾
  if (width > 128 && height > 128) return imageData;

  const getLum = (x, y) => {
    const p = getPixel(data, width, height, x, y);
    return p ? 0.299 * p.r + 0.587 * p.g + 0.114 * p.b : -1;
  };

  // 1단계: 외곽선 맵 생성
  // 주변 4방향 밝은 이웃이 2개 이상이고 밝기 차이 > lumDiff 이면 외곽선
  const lumDiff = 45;
  const isOutline = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cLum = getLum(x, y);
      if (cLum < 0) continue;
      let brighterCount = 0;
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      for (const [dx, dy] of dirs) {
        const nLum = getLum(x + dx, y + dy);
        if (nLum >= 0 && (nLum - cLum) > lumDiff) brighterCount++;
      }
      if (brighterCount >= 2) isOutline[y * width + x] = 1;
    }
  }

  // 2단계: 두꺼운 외곽선 픽셀 제거
  // 외곽선 픽셀이 수평 또는 수직으로 인접한 외곽선 픽셀을 가지면,
  // 밝은 이웃이 더 적은 쪽(= 안쪽)을 제거 대상으로 표시
  const result = new Uint8ClampedArray(data);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isOutline[y * width + x]) continue;

      // 수평 인접 확인
      const hasRight = x + 1 < width && isOutline[y * width + x + 1];
      const hasLeft = x - 1 >= 0 && isOutline[y * width + x - 1];
      // 수직 인접 확인
      const hasDown = y + 1 < height && isOutline[(y + 1) * width + x];
      const hasUp = y - 1 >= 0 && isOutline[(y - 1) * width + x];

      if (!hasRight && !hasLeft && !hasDown && !hasUp) continue;

      // 이 픽셀 주변 밝은 이웃 수 계산
      const cLum = getLum(x, y);
      let myBrightNeighbors = 0;
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      for (const [dx, dy] of dirs) {
        const nLum = getLum(x + dx, y + dy);
        if (nLum >= 0 && (nLum - cLum) > lumDiff) myBrightNeighbors++;
      }

      // 인접 외곽선 픽셀 중 밝은 이웃이 더 많은 것이 "바깥쪽" → 보존
      // 밝은 이웃이 적은 것이 "안쪽" → 제거 대상
      let shouldRemove = false;
      for (const [dx, dy] of dirs) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        if (!isOutline[ny * width + nx]) continue;

        const nLumCenter = getLum(nx, ny);
        let neighborBrightCount = 0;
        for (const [ddx, ddy] of dirs) {
          const nnLum = getLum(nx + ddx, ny + ddy);
          if (nnLum >= 0 && (nnLum - nLumCenter) > lumDiff) neighborBrightCount++;
        }

        // 인접 외곽선이 나보다 밝은 이웃을 더 많이 가짐 → 인접이 바깥, 나는 안쪽
        if (neighborBrightCount > myBrightNeighbors) {
          shouldRemove = true;
          break;
        }
      }

      if (shouldRemove) {
        // 주변 밝은 픽셀의 평균으로 대체
        let rSum = 0, gSum = 0, bSum = 0, cnt = 0;
        for (const [dx, dy] of dirs) {
          const p = getPixel(data, width, height, x + dx, y + dy);
          if (!p) continue;
          const pLum = 0.299 * p.r + 0.587 * p.g + 0.114 * p.b;
          if ((pLum - cLum) > lumDiff) {
            rSum += p.r; gSum += p.g; bSum += p.b; cnt++;
          }
        }
        if (cnt > 0) {
          setPixel(result, width, x, y,
            Math.round(rSum / cnt), Math.round(gSum / cnt), Math.round(bSum / cnt), 255);
        }
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
