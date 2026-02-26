/**
 * LAB 색공간 K-Means++ 색상 양자화
 * 인간 시각에 자연스러운 팔레트를 생성하기 위해 RGB 대신 LAB 공간 사용
 */

// ─── RGB ↔ LAB 변환 ─────────────────────────────────────────────────────────

function rgbToXyz(r, g, b) {
  let rr = r / 255, gg = g / 255, bb = b / 255;
  rr = rr > 0.04045 ? Math.pow((rr + 0.055) / 1.055, 2.4) : rr / 12.92;
  gg = gg > 0.04045 ? Math.pow((gg + 0.055) / 1.055, 2.4) : gg / 12.92;
  bb = bb > 0.04045 ? Math.pow((bb + 0.055) / 1.055, 2.4) : bb / 12.92;
  return {
    x: rr * 0.4124564 + gg * 0.3575761 + bb * 0.1804375,
    y: rr * 0.2126729 + gg * 0.7151522 + bb * 0.0721750,
    z: rr * 0.0193339 + gg * 0.1191920 + bb * 0.9503041,
  };
}

function xyzToLab(x, y, z) {
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(x / 0.95047), fy = f(y / 1.0), fz = f(z / 1.08883);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function rgbToLab(r, g, b) {
  const { x, y, z } = rgbToXyz(r, g, b);
  return xyzToLab(x, y, z);
}

function labToXyz(L, a, b) {
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const f3 = t => t > 0.206897 ? t * t * t : (t - 16 / 116) / 7.787;
  return { x: f3(fx) * 0.95047, y: f3(fy) * 1.0, z: f3(fz) * 1.08883 };
}

export function labToRgb(L, a, b) {
  const { x, y, z } = labToXyz(L, a, b);
  let r = x * 3.2404542 - y * 1.5371385 - z * 0.4985314;
  let g = -x * 0.9692660 + y * 1.8760108 + z * 0.0415560;
  let bl = x * 0.0556434 - y * 0.2040259 + z * 1.0572252;
  const gamma = c => c > 0.0031308 ? 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055 : 12.92 * Math.max(0, c);
  return {
    r: Math.round(Math.max(0, Math.min(255, gamma(r) * 255))),
    g: Math.round(Math.max(0, Math.min(255, gamma(g) * 255))),
    b: Math.round(Math.max(0, Math.min(255, gamma(bl) * 255))),
  };
}

export function labDistance(c1, c2) {
  const dL = c1.L - c2.L, da = c1.a - c2.a, db = c1.b - c2.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

// ─── K-Means++ ───────────────────────────────────────────────────────────────

/**
 * 이미지에서 numColors개의 대표 팔레트를 추출
 * - 전체 픽셀의 10% 랜덤 샘플링 (성능 최적화)
 * - K-Means++ 초기화로 수렴 속도 향상
 */
export function quantizeColors(imageData, numColors) {
  const { data, width, height } = imageData;
  const total = width * height;
  const labPixels = [];

  // 10% 샘플링 (불투명 픽셀만)
  for (let i = 0; i < total; i++) {
    if (data[i * 4 + 3] > 128 && Math.random() < 0.1) {
      labPixels.push(rgbToLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]));
    }
  }

  // 샘플이 너무 적으면 전체 사용
  if (labPixels.length < numColors * 2) {
    labPixels.length = 0;
    for (let i = 0; i < total; i++) {
      if (data[i * 4 + 3] > 128) {
        labPixels.push(rgbToLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]));
      }
    }
  }

  if (labPixels.length === 0) return [{ r: 0, g: 0, b: 0 }];

  const initCentroids = kMeansPlusPlus(labPixels, Math.min(numColors, labPixels.length));
  const { centroids, counts } = kMeansIterate(labPixels, initCentroids);

  // 유사 색상 병합 (LAB ΔE < 6 → 인간 눈에 구분 어려운 색상 통합)
  const merged = mergeSimilarCentroids(centroids, counts);
  return merged.map(c => labToRgb(c.L, c.a, c.b));
}

function kMeansPlusPlus(pixels, k) {
  const centroids = [{ ...pixels[Math.floor(Math.random() * pixels.length)] }];

  while (centroids.length < k) {
    const dists = pixels.map(p => {
      let min = Infinity;
      for (const c of centroids) {
        const d = labDistance(p, c);
        if (d < min) min = d;
      }
      return min * min;
    });

    const total = dists.reduce((s, d) => s + d, 0);
    let r = Math.random() * total;
    for (let i = 0; i < dists.length; i++) {
      r -= dists[i];
      if (r <= 0) { centroids.push({ ...pixels[i] }); break; }
    }
    if (centroids.length < k) centroids.push({ ...pixels[pixels.length - 1] });
  }

  return centroids;
}

function kMeansIterate(pixels, centroids) {
  const k = centroids.length;
  let counts = new Array(k).fill(0);

  for (let iter = 0; iter < 30; iter++) {
    const sums = Array.from({ length: k }, () => ({ L: 0, a: 0, b: 0, n: 0 }));

    for (const p of pixels) {
      let minD = Infinity, best = 0;
      for (let i = 0; i < k; i++) {
        const d = labDistance(p, centroids[i]);
        if (d < minD) { minD = d; best = i; }
      }
      sums[best].L += p.L;
      sums[best].a += p.a;
      sums[best].b += p.b;
      sums[best].n++;
    }

    counts = sums.map(s => s.n);

    let changed = false;
    for (let i = 0; i < k; i++) {
      if (sums[i].n === 0) continue;
      const nL = sums[i].L / sums[i].n;
      const na = sums[i].a / sums[i].n;
      const nb = sums[i].b / sums[i].n;
      if (Math.abs(nL - centroids[i].L) > 0.5 || Math.abs(na - centroids[i].a) > 0.5 || Math.abs(nb - centroids[i].b) > 0.5) {
        changed = true;
      }
      centroids[i] = { L: nL, a: na, b: nb };
    }

    if (!changed) break;
  }

  return { centroids, counts };
}

/**
 * 유사 색상 병합: ΔE < minDeltaE인 centroid 쌍을 픽셀 수 가중 평균으로 통합
 * 픽셀 수가 많은 클러스터 기준으로 병합하여 주요 색상 보존
 */
function mergeSimilarCentroids(centroids, counts, minDeltaE = 6) {
  const order = centroids.map((_, i) => i).sort((a, b) => counts[b] - counts[a]);
  const merged = [];
  const mergedCounts = [];
  const used = new Set();

  for (const i of order) {
    if (used.has(i)) continue;
    let sumL = centroids[i].L * counts[i];
    let suma = centroids[i].a * counts[i];
    let sumb = centroids[i].b * counts[i];
    let totalN = counts[i];

    for (const j of order) {
      if (i === j || used.has(j)) continue;
      if (labDistance(centroids[i], centroids[j]) < minDeltaE) {
        sumL += centroids[j].L * counts[j];
        suma += centroids[j].a * counts[j];
        sumb += centroids[j].b * counts[j];
        totalN += counts[j];
        used.add(j);
      }
    }

    merged.push({ L: sumL / totalN, a: suma / totalN, b: sumb / totalN });
    mergedCounts.push(totalN);
    used.add(i);
  }

  return merged;
}

// ─── 팔레트 매핑 ─────────────────────────────────────────────────────────────

/**
 * 각 픽셀을 팔레트의 가장 가까운 색상으로 매핑 (LAB ΔE 기준)
 */
export function mapToPalette(imageData, palette) {
  const { data, width, height } = imageData;
  const labPalette = palette.map(c => ({ lab: rgbToLab(c.r, c.g, c.b), rgb: c }));
  const result = new Uint8ClampedArray(data.length);

  for (let i = 0; i < width * height; i++) {
    if (data[i * 4 + 3] < 128) { result[i * 4 + 3] = 0; continue; }

    const lab = rgbToLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    let minD = Infinity, best = labPalette[0].rgb;

    for (const { lab: pl, rgb } of labPalette) {
      const d = labDistance(lab, pl);
      if (d < minD) { minD = d; best = rgb; }
    }

    result[i * 4] = best.r;
    result[i * 4 + 1] = best.g;
    result[i * 4 + 2] = best.b;
    result[i * 4 + 3] = 255;
  }

  return new ImageData(result, width, height);
}
