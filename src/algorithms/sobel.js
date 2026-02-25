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
export function sobelDownsample(imageData, targetWidth, targetHeight) {
  const { data, width, height } = imageData;
  const { edges } = sobelEdgeDetect(imageData);

  const blockW = Math.ceil(width / targetWidth);
  const blockH = Math.ceil(height / targetHeight);
  const result = new Uint8ClampedArray(targetWidth * targetHeight * 4);

  for (let ty = 0; ty < targetHeight; ty++) {
    for (let tx = 0; tx < targetWidth; tx++) {
      const startX = tx * blockW;
      const startY = ty * blockH;
      const endX = Math.min(startX + blockW, width);
      const endY = Math.min(startY + blockH, height);

      let r = 0, g = 0, b = 0, a = 0, count = 0;

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = y * width + x;
          // 엣지 픽셀 가중치 2× (기존 3×에서 감소 — 외곽색이 블록 전체를 오염시키는 현상 완화)
          const w = edges[idx] ? 2 : 1;
          r += data[idx * 4] * w;
          g += data[idx * 4 + 1] * w;
          b += data[idx * 4 + 2] * w;
          a += data[idx * 4 + 3] * w;
          count += w;
        }
      }

      const tidx = (ty * targetWidth + tx) * 4;
      if (count > 0) {
        result[tidx] = r / count;
        result[tidx + 1] = g / count;
        result[tidx + 2] = b / count;
        result[tidx + 3] = a / count;
      }
    }
  }

  return new ImageData(result, targetWidth, targetHeight);
}
