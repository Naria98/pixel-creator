/**
 * 변환 엔진 오케스트레이터
 * Web Worker와 통신하며 변환 파이프라인을 관리
 */

export class Converter {
  constructor() {
    this._worker = null;
    this._onProgress = null;
    this._onDone = null;
    this._onError = null;
  }

  _initWorker() {
    if (this._worker) { this._worker.terminate(); }
    this._worker = new Worker(new URL('../workers/pixelWorker.js', import.meta.url), { type: 'module' });
    this._worker.onmessage = (e) => {
      const { type, pct, imageData, palette, message } = e.data;
      if (type === 'progress' && this._onProgress) this._onProgress(pct);
      if (type === 'done' && this._onDone) this._onDone(imageData, palette);
      if (type === 'error' && this._onError) this._onError(message);
    };
    this._worker.onerror = (e) => {
      if (this._onError) this._onError(e.message);
    };
  }

  /**
   * 이미지를 픽셀아트로 변환
   * @param {ImageData} imageData  - 원본 이미지
   * @param {object} options       - 변환 옵션
   * @returns {Promise<{imageData, palette}>}
   */
  convert(imageData, options) {
    return new Promise((resolve, reject) => {
      this._initWorker();
      this._onDone = (result, palette) => resolve({ imageData: result, palette });
      this._onError = (msg) => reject(new Error(msg));
      // ImageData.data는 transferable
      const transferable = imageData.data.buffer.byteLength > 0 ? [imageData.data.buffer] : [];
      this._worker.postMessage({ type: 'convert', imageData, options }, transferable);
    });
  }

  /**
   * 업스케일된 픽셀아트를 진짜 픽셀 크기로 변환 (픽셀 감지 모드)
   * @param {ImageData} imageData  - 원본 (업스케일된) 이미지
   * @param {object} options       - { blockSize, method, applyPalette, numColors, removeLonely }
   * @returns {Promise<{imageData, palette}>}
   */
  truePixelize(imageData, options) {
    return new Promise((resolve, reject) => {
      this._initWorker();
      this._onDone = (result, palette) => resolve({ imageData: result, palette });
      this._onError = (msg) => reject(new Error(msg));
      const transferable = imageData.data.buffer.byteLength > 0 ? [imageData.data.buffer] : [];
      this._worker.postMessage({ type: 'truePixelize', imageData, options }, transferable);
    });
  }

  onProgress(cb) { this._onProgress = cb; return this; }

  cancel() {
    if (this._worker) { this._worker.terminate(); this._worker = null; }
  }
}

/**
 * 이미지 파일 → ImageData 변환 헬퍼
 */
export function loadImageData(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    img.onerror = () => reject(new Error('이미지 로드 실패'));
    img.src = url;
  });
}

/**
 * URL/ObjectURL → ImageData
 */
export function loadImageDataFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      resolve(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height));
    };
    img.onerror = () => reject(new Error('URL 로드 실패'));
    img.src = url;
  });
}

/**
 * 기본 변환 옵션
 */
export const DEFAULT_OPTIONS = {
  targetWidth: 64,
  targetHeight: 64,
  numColors: 16,
  dithering: 'none',       // 'none' | 'bayer' | 'floyd' | 'atkinson'
  removeBackgroundAuto: false,
  antiAliasEnabled: true,
  selectiveOutlineEnabled: false,
  lightDir: 'top-left',
  removeLonely: true,
  preventBandingEnabled: true,
};
