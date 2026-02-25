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
import { antiAlias, selectiveOutline, removeLonelyPixels, preventBanding } from '../algorithms/postprocess.js';

self.onmessage = async (e) => {
  const { type, imageData, options } = e.data;
  if (type !== 'convert') return;

  try {
    const result = await convert(imageData, options, (pct) => {
      self.postMessage({ type: 'progress', pct });
    });
    self.postMessage({ type: 'done', imageData: result.imageData, palette: result.palette }, [result.imageData.data.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
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
  } = opts;

  onProgress(5);

  // 1단계: Sobel 엣지 가이드 다운샘플링
  let current = sobelDownsample(imageData, targetWidth, targetHeight);
  onProgress(20);

  // 2단계: 배경 자동 제거 (선택)
  if (removeBackgroundAuto) {
    const dataCopy = new Uint8ClampedArray(current.data);
    const { removeBackground: rmBg } = await import('../algorithms/floodfill.js');
    rmBg(dataCopy, current.width, current.height, 40);
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
  onProgress(75);

  // 6단계: 후처리
  if (antiAliasEnabled) {
    current = antiAlias(current);
  }
  onProgress(82);

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
