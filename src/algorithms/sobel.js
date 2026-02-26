/**
 * Sobel edge detection + Otsu's Method auto-thresholding
 * Otsu: Sobel 필터로 경계선 감지 후 자동 임계값 계산
 */

export function sobelEdgeDetect(imageData) {
  const { data, width, height } = imageData;

  // Grayscale 변환
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }

  const mag = new Float32Array(width * height);
  const angle = new Float32Array(width * height);
  let maxMag = 0;

  // Sobel 연산자 적용
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const gx =
        -gray[(y - 1) * width + (x - 1)] + gray[(y - 1) * width + (x + 1)] +
        -2 * gray[y * width + (x - 1)] + 2 * gray[y * width + (x + 1)] +
        -gray[(y + 1) * width + (x - 1)] + gray[(y + 1) * width + (x + 1)];

      const gy =
        -gray[(y - 1) * width + (x - 1)] - 2 * gray[(y - 1) * width + x] - gray[(y - 1) * width + (x + 1)] +
        gray[(y + 1) * width + (x - 1)] + 2 * gray[(y + 1) * width + x] + gray[(y + 1) * width + (x + 1)];

      const m = Math.sqrt(gx * gx + gy * gy);
      mag[y * width + x] = m;
      angle[y * width + x] = Math.atan2(gy, gx);
      if (m > maxMag) maxMag = m;
    }
  }

  // 정규화 [0, 1]
  const normMag = new Float32Array(width * height);
  if (maxMag > 0) {
    for (let i = 0; i < mag.length; i++) normMag[i] = mag[i] / maxMag;
  }

  // Otsu 임계값
  const threshold = otsuThreshold(normMag);

  // 이진 엣지 맵
  const edges = new Uint8Array(width * height);
  for (let i = 0; i < normMag.length; i++) {
    edges[i] = normMag[i] >= threshold ? 1 : 0;
  }

  return { edges, magnitude: normMag, angle, threshold };
}

function otsuThreshold(data) {
  const hist = new Float32Array(256);
  for (let i = 0; i < data.length; i++) {
    hist[Math.min(255, Math.floor(data[i] * 255))]++;
  }
  const N = data.length;
  for (let i = 0; i < 256; i++) hist[i] /= N;

  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  let wB = 0, sumB = 0, maxVar = 0, best = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = 1 - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) ** 2;
    if (variance > maxVar) { maxVar = variance; best = t; }
  }
  return best / 255;
}

/**
 * Sobel 엣지 가이드 다운샘플링
 * 엣지 픽셀에 높은 가중치를 부여해 경계선 선명도 보존
 */
export function sobelDownsample(imageData, targetWidth, targetHeight, { legacyEdge = false } = {}) {
  const { data, width, height } = imageData;

  // 축소 비율이 6×를 초과하면 단계적 다운샘플링:
  //   중간 단계는 반드시 boxDownsample(단순 평균) 사용
  //   sobelDownsample을 재귀 호출하면 두 단계 모두 엣지 가중치 2×가
  //   누적되어 64px에서 외곽선이 오히려 더 두꺼워지는 역효과 발생
  //   → 박스 필터로 공간 정보만 축소 후 최종 단계에서만 Sobel 가이드 적용
  const maxRatio = Math.max(width / targetWidth, height / targetHeight);
  if (maxRatio > 6) {
    const midW = Math.round(targetWidth * 4);
    const midH = Math.round(targetHeight * 4);
    if (midW < width && midH < height) {
      const intermediate = boxDownsample(imageData, midW, midH);
      return sobelDownsample(intermediate, targetWidth, targetHeight, { legacyEdge });
    }
  }

  const { edges } = sobelEdgeDetect(imageData);

  const result = new Uint8ClampedArray(targetWidth * targetHeight * 4);

  // legacyEdge=true: 이전 방식 (블록 ≤4px이면 가중치 2×)
  // legacyEdge=false: 개선 방식 (항상 1, 커버리지 기반 판정으로 대체)
  const avgBlock = ((width / targetWidth) + (height / targetHeight)) / 2;
  const edgeWeight = legacyEdge ? (avgBlock <= 4 ? 2 : 1) : 1;

  for (let ty = 0; ty < targetHeight; ty++) {
    for (let tx = 0; tx < targetWidth; tx++) {
      // 실수 비율 기반 블록 경계 — 소스 픽셀을 균등 분배하여 중앙 정렬 유지
      const startX = Math.round(tx * width / targetWidth);
      const startY = Math.round(ty * height / targetHeight);
      const endX = Math.round((tx + 1) * width / targetWidth);
      const endY = Math.round((ty + 1) * height / targetHeight);

      let r = 0, g = 0, b = 0, a = 0, count = 0;
      // 엣지 픽셀과 비엣지 픽셀을 분리 집계 — 외곽선 색상 우선 선택에 사용
      let er = 0, eg = 0, eb = 0, eCount = 0;
      let nr = 0, ng = 0, nb = 0, nCount = 0;

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = y * width + x;
          const i = idx * 4;
          const w = edges[idx] ? edgeWeight : 1;
          r += data[i] * w; g += data[i + 1] * w;
          b += data[i + 2] * w; a += data[i + 3] * w;
          count += w;
          if (edges[idx]) {
            er += data[i]; eg += data[i + 1]; eb += data[i + 2]; eCount++;
          } else {
            nr += data[i]; ng += data[i + 1]; nb += data[i + 2]; nCount++;
          }
        }
      }

      const tidx = (ty * targetWidth + tx) * 4;
      const totalPixels = eCount + nCount;
      if (count > 0 && totalPixels > 0) {
        let useEdge = false;
        if (eCount > 0 && nCount > 0) {
          const eLum = (0.299 * er + 0.587 * eg + 0.114 * eb) / eCount;
          const nLum = (0.299 * nr + 0.587 * ng + 0.114 * nb) / nCount;
          if (legacyEdge) {
            // 이전 방식: 밝기 차이만 보고 판단
            useEdge = (nLum - eLum) > 40;
          } else {
            // 개선 방식: 밝기 차이 + 커버리지 30% 이상
            const edgeCoverage = eCount / totalPixels;
            useEdge = (nLum - eLum) > 40 && edgeCoverage > 0.30;
          }
        }
        if (useEdge) {
          result[tidx]     = Math.round(er / eCount);
          result[tidx + 1] = Math.round(eg / eCount);
          result[tidx + 2] = Math.round(eb / eCount);
          result[tidx + 3] = 255;
        } else {
          result[tidx]     = Math.round(r / count);
          result[tidx + 1] = Math.round(g / count);
          result[tidx + 2] = Math.round(b / count);
          result[tidx + 3] = Math.round(a / count);
        }
      } else if (count > 0) {
        result[tidx]     = Math.round(r / count);
        result[tidx + 1] = Math.round(g / count);
        result[tidx + 2] = Math.round(b / count);
        result[tidx + 3] = Math.round(a / count);
      }
    }
  }

  return new ImageData(result, targetWidth, targetHeight);
}

/**
 * 단순 박스 필터 다운샘플링 — 엣지 가중치 없이 균일 평균
 * sobelDownsample의 중간 단계 전처리 전용:
 *   큰 소스를 먼저 공간적으로 축소해 sobelDownsample의 블록 크기를
 *   4px 이하로 맞춤 → 엣지 가중치 누적 없이 깨끗한 중간 이미지 생성
 */
function boxDownsample(imageData, targetWidth, targetHeight) {
  const { data, width, height } = imageData;
  const result = new Uint8ClampedArray(targetWidth * targetHeight * 4);

  for (let ty = 0; ty < targetHeight; ty++) {
    for (let tx = 0; tx < targetWidth; tx++) {
      const startX = Math.round(tx * width / targetWidth);
      const startY = Math.round(ty * height / targetHeight);
      const endX = Math.round((tx + 1) * width / targetWidth);
      const endY = Math.round((ty + 1) * height / targetHeight);

      let r = 0, g = 0, b = 0, a = 0, count = 0;
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const i = (y * width + x) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; a += data[i + 3];
          count++;
        }
      }
      const ti = (ty * targetWidth + tx) * 4;
      if (count > 0) {
        result[ti] = r / count; result[ti + 1] = g / count;
        result[ti + 2] = b / count; result[ti + 3] = a / count;
      }
    }
  }
  return new ImageData(result, targetWidth, targetHeight);
}
