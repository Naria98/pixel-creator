/**
 * Web Worker — 무거운 변환 연산을 메인 스레드와 분리
 * 메시지 프로토콜:
 *   { type: 'convert', imageData, options }
 *   → { type: 'progress', pct }
 *   → { type: 'done', imageData, palette }
 *   → { type: 'error', message }
 */

import { sobelDownsample } from '../algorithms/sobel.js';
import { quantizeColors, mapToPalette } from '../algorithms/kmeans.js';
import { applyDithering } from '../algorithms/dithering.js';
import { removeBackground, floodFill } from '../algorithms/floodfill.js';
import { antiAlias, selectiveOutline, removeLonelyPixels, preventBanding, thinOutlines } from '../algorithms/postprocess.js';
import { truePixelize } from '../algorithms/blockdetect.js';

self.onmessage = async (e) => {
  const { type, imageData, options } = e.data;

  if (type === 'convert') {
    try {
      const result = await convert(imageData, options, (pct) => {
        self.postMessage({ type: 'progress', pct });
      });
      self.postMessage({ type: 'done', imageData: result.imageData, palette: result.palette }, [result.imageData.data.buffer]);
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }

  } else if (type === 'truePixelize') {
    try {
      const result = await runTruePixelize(imageData, options, (pct) => {
        self.postMessage({ type: 'progress', pct });
      });
      self.postMessage({ type: 'done', imageData: result.imageData, palette: result.palette }, [result.imageData.data.buffer]);
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
  }
};

async function convert(imageData, opts, onProgress) {
  const {
    targetWidth,
    targetHeight,
    numColors = 16,
    dithering = 'none',
    removeBackgroundAuto = false,
    antiAliasEnabled = true,
    selectiveOutlineEnabled = false,
    lightDir = 'top-left',
    removeLonely = true,
    preventBandingEnabled = true,
    thinOutlinesEnabled = true,
  } = opts;

  onProgress(5);

  // 1단계: Sobel 엣지 가이드 다운샘플링
  let current = sobelDownsample(imageData, targetWidth, targetHeight, { legacyEdge: !thinOutlinesEnabled });
  onProgress(20);

  // 2단계: 배경 자동 제거 (선택)
  if (removeBackgroundAuto) {
    const dataCopy = new Uint8ClampedArray(current.data);
    removeBackground(dataCopy, current.width, current.height, 40);
    current = new ImageData(dataCopy, current.width, current.height);
  }
  onProgress(30);

  // 3단계: LAB K-Means++ 팔레트 추출
  const palette = quantizeColors(current, numColors);
  onProgress(50);

  // 4단계: 팔레트 매핑
  current = mapToPalette(current, palette);
  onProgress(65);

  // 5단계: 디더링 (선택)
  if (dithering !== 'none') {
    current = applyDithering(current, palette, dithering);
  }
  onProgress(72);

  // 5.5단계: 외곽선 씨닝 — 다운샘플링으로 두꺼워진 외곽선을 1px로 정리
  if (thinOutlinesEnabled) {
    current = thinOutlines(current);
  }
  onProgress(78);

  // 6단계: 후처리
  if (antiAliasEnabled) {
    current = antiAlias(current);
  }
  onProgress(84);

  if (selectiveOutlineEnabled) {
    current = selectiveOutline(current, lightDir);
  }
  onProgress(88);

  if (removeLonely) {
    current = removeLonelyPixels(current);
  }
  onProgress(93);

  if (preventBandingEnabled) {
    current = preventBanding(current);
  }
  onProgress(100);

  return { imageData: current, palette };
}

/**
 * 픽셀 감지 변환 파이프라인
 * 1. truePixelize   — 블록 크기로 다운샘플 → 진짜 픽셀 크기
 * 2. 팔레트 최적화  — K-Means++ (선택)
 * 3. Lonely Pixel 제거 (선택)
 */
async function runTruePixelize(imageData, opts, onProgress) {
  const {
    blockSize = 4,
    method = 'mode',
    applyPalette = true,
    numColors = 16,
    removeLonely = true,
  } = opts;

  onProgress(10);

  // 1단계: 블록 크기로 다운샘플 → 진짜 픽셀아트 크기
  let current = truePixelize(imageData, blockSize, method);
  onProgress(50);

  // 2단계: 팔레트 최적화 (색상 수 정제)
  let palette = [];
  if (applyPalette && current.width > 0 && current.height > 0) {
    palette = quantizeColors(current, numColors);
    onProgress(70);
    current = mapToPalette(current, palette);
    onProgress(85);
  }

  // 3단계: Lonely Pixel 제거
  if (removeLonely) {
    current = removeLonelyPixels(current);
  }
  onProgress(100);

  return { imageData: current, palette };
}
