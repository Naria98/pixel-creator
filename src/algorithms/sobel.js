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

  // 축소 비율이 6×를 초과하면 단계적 다운샘플링:
  //   512→32 (비율 16): 512→128(4×4블록) → 128→32(4×4블록)
  //   한 번에 16×16 블록을 평균하면 지배색이 희석돼 이미지가 뭉개짐
  const maxRatio = Math.max(width / targetWidth, height / targetHeight);
  if (maxRatio > 6) {
    const midW = Math.round(targetWidth * 4);
    const midH = Math.round(targetHeight * 4);
    if (midW < width && midH < height) {
      const intermediate = sobelDownsample(imageData, midW, midH);
      return sobelDownsample(intermediate, targetWidth, targetHeight);
    }
  }

  const { edges } = sobelEdgeDetect(imageData);

  const blockW = Math.ceil(width / targetWidth);
  const blockH = Math.ceil(height / targetHeight);
  const result = new Uint8ClampedArray(targetWidth * targetHeight * 4);

  // 블록 크기에 따라 엣지 가중치를 조정:
  //   소형 블록(≤4px): 2× — 경계 선명도 보존
  //   대형 블록( >4px): 1× — 균일 가중치 (블록 전체에 외곽색이 번지는 현상 방지)
  //   64px 출력처럼 블록이 8px 이상일 때 외곽선이 두꺼워지던 원인
  const avgBlock = (blockW + blockH) / 2;
  const edgeWeight = avgBlock <= 4 ? 2 : 1;

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
          const w = edges[idx] ? edgeWeight : 1;
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
