/**
 * 픽셀 에디터 상태 관리
 * - 레이어 시스템
 * - Delta 방식 Undo/Redo (50단계)
 * - 프레임 시스템
 * - GIF/PNG/스프라이트시트 내보내기
 */

export class PixelEditor {
  constructor(width = 64, height = 64) {
    this.width = width;
    this.height = height;

    this._layers = [];
    this._activeLayerIdx = 0;
    this._frames = [];
    this._activeFrameIdx = 0;

    this._undoStack = [];
    this._redoStack = [];
    this.MAX_UNDO = 50;

    this._listeners = {};

    // 기본 프레임 + 레이어 생성
    this.addFrame();
  }

  // ─── 이벤트 ────────────────────────────────────────────────────────────────

  on(event, cb) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(cb);
  }

  off(event, cb) {
    if (this._listeners[event]) {
      this._listeners[event] = this._listeners[event].filter(f => f !== cb);
    }
  }

  emit(event, data) {
    (this._listeners[event] || []).forEach(cb => cb(data));
  }

  // ─── 레이어 ────────────────────────────────────────────────────────────────

  get layers() { return this._frames[this._activeFrameIdx]?.layers || []; }
  get activeLayer() { return this.layers[this._activeLayerIdx] || null; }
  get activeLayerIdx() { return this._activeLayerIdx; }

  addLayer(name, below = false) {
    const layer = this._createLayer(name || `Layer ${this.layers.length + 1}`);
    if (below) {
      this.layers.splice(this._activeLayerIdx, 0, layer);
    } else {
      this.layers.splice(this._activeLayerIdx + 1, 0, layer);
      this._activeLayerIdx++;
    }
    this.emit('layersChanged');
    return layer;
  }

  _createLayer(name) {
    return {
      name,
      visible: true,
      opacity: 1.0,
      locked: false,
      dirty: true,
      data: new Uint8ClampedArray(this.width * this.height * 4),
    };
  }

  removeLayer(idx) {
    if (this.layers.length <= 1) return;
    this.layers.splice(idx, 1);
    this._activeLayerIdx = Math.min(this._activeLayerIdx, this.layers.length - 1);
    this.emit('layersChanged');
  }

  setActiveLayer(idx) {
    this._activeLayerIdx = idx;
    this.emit('layersChanged');
  }

  moveLayer(fromIdx, toIdx) {
    const [layer] = this.layers.splice(fromIdx, 1);
    this.layers.splice(toIdx, 0, layer);
    this._activeLayerIdx = toIdx;
    this.emit('layersChanged');
  }

  setLayerOpacity(idx, opacity) {
    if (this.layers[idx]) {
      this.layers[idx].opacity = Math.max(0, Math.min(1, opacity));
      this.layers[idx].dirty = true;
      this.emit('layersChanged');
    }
  }

  toggleLayerVisibility(idx) {
    if (this.layers[idx]) {
      this.layers[idx].visible = !this.layers[idx].visible;
      this.layers[idx].dirty = true;
      this.emit('layersChanged');
    }
  }

  mergeDown(idx) {
    if (idx <= 0 || idx >= this.layers.length) return;
    const top = this.layers[idx];
    const bottom = this.layers[idx - 1];
    const merged = this._createLayer(bottom.name);
    // 아래 레이어 위에 위 레이어를 합성
    for (let i = 0; i < this.width * this.height; i++) {
      const bi = i * 4;
      const ta = (top.data[bi + 3] / 255) * top.opacity;
      const ba = bottom.data[bi + 3] / 255;
      const outA = ta + ba * (1 - ta);
      if (outA === 0) continue;
      merged.data[bi] = Math.round((top.data[bi] * ta + bottom.data[bi] * ba * (1 - ta)) / outA);
      merged.data[bi + 1] = Math.round((top.data[bi + 1] * ta + bottom.data[bi + 1] * ba * (1 - ta)) / outA);
      merged.data[bi + 2] = Math.round((top.data[bi + 2] * ta + bottom.data[bi + 2] * ba * (1 - ta)) / outA);
      merged.data[bi + 3] = Math.round(outA * 255);
    }
    this.layers.splice(idx - 1, 2, merged);
    this._activeLayerIdx = Math.max(0, idx - 1);
    this.emit('layersChanged');
  }

  // 레이어 합성 → 최종 ImageData (Dirty Flag 방식)
  composite() {
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    const ctx = canvas.getContext('2d');

    for (const layer of this.layers) {
      if (!layer.visible) continue;
      const imgData = new ImageData(new Uint8ClampedArray(layer.data), this.width, this.height);
      const offscreen = document.createElement('canvas');
      offscreen.width = this.width;
      offscreen.height = this.height;
      offscreen.getContext('2d').putImageData(imgData, 0, 0);
      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(offscreen, 0, 0);
    }
    ctx.globalAlpha = 1;
    return ctx.getImageData(0, 0, this.width, this.height);
  }

  // ─── 픽셀 그리기 (Undo 기록 포함) ──────────────────────────────────────────

  beginStroke() {
    this._currentDelta = [];
    this._deltaMap = new Map();  // pixelIndex → delta 배열 인덱스
  }

  setPixel(x, y, r, g, b, a = 255) {
    const layer = this.activeLayer;
    if (!layer || layer.locked) return;
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;

    const idx = (y * this.width + x) * 4;
    const before = [layer.data[idx], layer.data[idx + 1], layer.data[idx + 2], layer.data[idx + 3]];

    layer.data[idx] = r;
    layer.data[idx + 1] = g;
    layer.data[idx + 2] = b;
    layer.data[idx + 3] = a;
    layer.dirty = true;

    if (this._currentDelta) {
      const key = y * this.width + x;
      if (this._deltaMap.has(key)) {
        // 같은 픽셀 재기록: before(원본)은 유지, after만 최신값으로 갱신
        this._currentDelta[this._deltaMap.get(key)].after = [r, g, b, a];
      } else {
        // 첫 기록: 원본 before 저장
        this._deltaMap.set(key, this._currentDelta.length);
        this._currentDelta.push({ x, y, before, after: [r, g, b, a] });
      }
    }
  }

  getPixel(x, y, layerIdx) {
    const layer = layerIdx !== undefined ? this.layers[layerIdx] : this.activeLayer;
    if (!layer) return null;
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
    const idx = (y * this.width + x) * 4;
    return { r: layer.data[idx], g: layer.data[idx + 1], b: layer.data[idx + 2], a: layer.data[idx + 3] };
  }

  endStroke() {
    if (!this._currentDelta || this._currentDelta.length === 0) {
      this._currentDelta = null;
      this._deltaMap = null;
      return;
    }
    this._pushUndo({ type: 'stroke', layerIdx: this._activeLayerIdx, pixels: this._currentDelta });
    this._currentDelta = null;
    this._deltaMap = null;
  }

  // ─── Undo / Redo (Delta 방식) ──────────────────────────────────────────────

  _pushUndo(delta) {
    this._undoStack.push(delta);
    if (this._undoStack.length > this.MAX_UNDO) this._undoStack.shift();
    this._redoStack = [];
    this.emit('historyChanged');
  }

  undo() {
    if (this._undoStack.length === 0) return;
    const delta = this._undoStack.pop();
    this._applyDelta(delta, 'before');
    this._redoStack.push(delta);
    this.emit('historyChanged');
    this.emit('pixelsChanged');
  }

  redo() {
    if (this._redoStack.length === 0) return;
    const delta = this._redoStack.pop();
    this._applyDelta(delta, 'after');
    this._undoStack.push(delta);
    this.emit('historyChanged');
    this.emit('pixelsChanged');
  }

  _applyDelta(delta, direction) {
    // 레이어 삽입 Undo/Redo
    if (delta.type === 'insertLayer') {
      if (direction === 'before') {
        // Undo: 삽입된 레이어 제거
        this.layers.splice(delta.insertIdx, 1);
        this._activeLayerIdx = Math.min(this._activeLayerIdx, this.layers.length - 1);
        this.emit('layersChanged');
      } else {
        // Redo: 레이어 다시 삽입
        this.layers.splice(delta.insertIdx, 0, delta.layerData);
        this._activeLayerIdx = delta.insertIdx;
        this.emit('layersChanged');
      }
      return;
    }

    const layer = this.layers[delta.layerIdx];
    if (!layer) return;
    for (const { x, y, before, after } of delta.pixels) {
      const idx = (y * this.width + x) * 4;
      const color = direction === 'before' ? before : after;
      layer.data[idx] = color[0];
      layer.data[idx + 1] = color[1];
      layer.data[idx + 2] = color[2];
      layer.data[idx + 3] = color[3];
    }
    layer.dirty = true;
  }

  canUndo() { return this._undoStack.length > 0; }
  canRedo() { return this._redoStack.length > 0; }

  // ─── 프레임 시스템 ─────────────────────────────────────────────────────────

  get frames() { return this._frames; }
  get activeFrameIdx() { return this._activeFrameIdx; }
  get fps() { return this._fps || 12; }
  set fps(v) { this._fps = v; }

  addFrame(copyFrom = null) {
    const layers = copyFrom !== null
      ? this._frames[copyFrom].layers.map(l => ({
          ...l, data: new Uint8ClampedArray(l.data), dirty: true,
        }))
      : [this._createLayer('Layer 1')];

    const frame = { layers, duration: 1 };
    this._frames.push(frame);
    this._activeFrameIdx = this._frames.length - 1;
    this._activeLayerIdx = 0;
    this.emit('framesChanged');
    return frame;
  }

  duplicateFrame(idx) {
    const src = this._frames[idx];
    const layers = src.layers.map(l => ({
      ...l, data: new Uint8ClampedArray(l.data), dirty: true,
    }));
    const frame = { layers, duration: src.duration };
    this._frames.splice(idx + 1, 0, frame);
    this._activeFrameIdx = idx + 1;
    this.emit('framesChanged');
  }

  removeFrame(idx) {
    if (this._frames.length <= 1) return;
    this._frames.splice(idx, 1);
    this._activeFrameIdx = Math.min(this._activeFrameIdx, this._frames.length - 1);
    this.emit('framesChanged');
  }

  setActiveFrame(idx) {
    this._activeFrameIdx = idx;
    this._activeLayerIdx = 0;
    this.emit('framesChanged');
  }

  // ─── 내보내기 ──────────────────────────────────────────────────────────────

  /** 현재 프레임 PNG로 내보내기 */
  exportPng() {
    const imgData = this.composite();
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    canvas.getContext('2d').putImageData(imgData, 0, 0);
    canvas.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'pixel.png';
      a.click();
    });
  }

  /** 스프라이트시트 내보내기 */
  exportSpritesheet(cols) {
    const n = this._frames.length;
    const rows = Math.ceil(n / cols);
    const canvas = document.createElement('canvas');
    canvas.width = this.width * cols;
    canvas.height = this.height * rows;
    const ctx = canvas.getContext('2d');

    this._frames.forEach((frame, i) => {
      const prev = this._activeFrameIdx;
      const prevLayers = this._frames[this._activeFrameIdx].layers;
      // 임시로 해당 프레임 레이어 사용
      const savedActive = this._activeFrameIdx;
      this._activeFrameIdx = i;
      const imgData = this.composite();
      this._activeFrameIdx = savedActive;

      const offscreen = document.createElement('canvas');
      offscreen.width = this.width;
      offscreen.height = this.height;
      offscreen.getContext('2d').putImageData(imgData, 0, 0);

      const col = i % cols;
      const row = Math.floor(i / cols);
      ctx.drawImage(offscreen, col * this.width, row * this.height);
    });

    canvas.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'spritesheet.png';
      a.click();
    });
  }

  /** GIF 내보내기 (gif.js 필요) */
  async exportGif() {
    if (!window.GIF) {
      alert('gif.js 라이브러리가 필요합니다.');
      return;
    }
    const gif = new window.GIF({
      workers: 2,
      quality: 10,
      width: this.width,
      height: this.height,
      workerScript: 'https://cdn.jsdelivr.net/npm/gif.js/dist/gif.worker.js',
    });

    const delay = Math.round(1000 / this.fps);
    const savedFrame = this._activeFrameIdx;

    for (let i = 0; i < this._frames.length; i++) {
      this._activeFrameIdx = i;
      const imgData = this.composite();
      const canvas = document.createElement('canvas');
      canvas.width = this.width;
      canvas.height = this.height;
      canvas.getContext('2d').putImageData(imgData, 0, 0);
      gif.addFrame(canvas, { delay });
    }

    this._activeFrameIdx = savedFrame;

    return new Promise(resolve => {
      gif.on('finished', blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'animation.gif';
        a.click();
        resolve();
      });
      gif.render();
    });
  }

  // ─── 프로젝트 저장/불러오기 ────────────────────────────────────────────────

  serialize() {
    return JSON.stringify({
      version: 1,
      width: this.width,
      height: this.height,
      fps: this.fps,
      frames: this._frames.map(frame => ({
        duration: frame.duration,
        layers: frame.layers.map(layer => ({
          name: layer.name,
          visible: layer.visible,
          opacity: layer.opacity,
          locked: layer.locked,
          data: Array.from(layer.data),
        })),
      })),
    });
  }

  deserialize(json) {
    const data = JSON.parse(json);
    this.width = data.width;
    this.height = data.height;
    this._fps = data.fps || 12;
    this._frames = data.frames.map(frame => ({
      duration: frame.duration,
      layers: frame.layers.map(layer => ({
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        locked: layer.locked,
        dirty: true,
        data: new Uint8ClampedArray(layer.data),
      })),
    }));
    this._activeFrameIdx = 0;
    this._activeLayerIdx = 0;
    this._undoStack = [];
    this._redoStack = [];
    this.emit('framesChanged');
    this.emit('layersChanged');
    this.emit('pixelsChanged');
  }

  /** 변환 결과를 새 레이어로 삽입 (Undo 가능) */
  insertConversionResult(imageData) {
    const layer = this._createLayer('변환 결과');
    layer.data = new Uint8ClampedArray(imageData.data);
    layer.dirty = true;
    this.layers.unshift(layer);
    this._activeLayerIdx = 0;
    this._pushUndo({ type: 'insertLayer', insertIdx: 0, layerData: layer });
    this.emit('layersChanged');
    this.emit('pixelsChanged');
  }
}
