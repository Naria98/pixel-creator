/**
 * Canvas 렌더링 / 레이어 합성 / 확대-축소 / 격자
 * Dirty Flag 방식: 변경된 레이어만 재합성
 */

export class CanvasRenderer {
  constructor(canvasEl, editor) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.editor = editor;

    this.zoom = 8;           // 기본 8배 확대
    this.maxZoom = 32;
    this.minZoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.showGrid = true;
    this.showCheckerboard = true;

    this._isPanning = false;
    this._panStart = null;

    this._offscreen = document.createElement('canvas');
    this._offscreen.width = editor.width;
    this._offscreen.height = editor.height;

    this._dirty = true;

    // 에디터 변경 감지
    editor.on('pixelsChanged', () => { this._dirty = true; this.render(); });
    editor.on('layersChanged', () => { this._dirty = true; this.render(); });
    editor.on('framesChanged', () => { this._dirty = true; this.render(); });

    this._bindEvents();
    this.fitToCanvas();
  }

  // ─── 뷰 관리 ──────────────────────────────────────────────────────────────

  fitToCanvas() {
    const scaleX = (this.canvas.width * 0.9) / this.editor.width;
    const scaleY = (this.canvas.height * 0.9) / this.editor.height;
    this.zoom = Math.floor(Math.min(scaleX, scaleY));
    this.zoom = Math.max(1, Math.min(this.maxZoom, this.zoom));
    this.centerView();
  }

  centerView() {
    this.panX = Math.round((this.canvas.width - this.editor.width * this.zoom) / 2);
    this.panY = Math.round((this.canvas.height - this.editor.height * this.zoom) / 2);
    this.render();
  }

  setZoom(z) {
    const cx = this.canvas.width / 2, cy = this.canvas.height / 2;
    const wx = (cx - this.panX) / this.zoom;
    const wy = (cy - this.panY) / this.zoom;
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, z));
    this.panX = Math.round(cx - wx * this.zoom);
    this.panY = Math.round(cy - wy * this.zoom);
    this.render();
  }

  // 캔버스 좌표 → 픽셀 좌표
  screenToPixel(sx, sy) {
    return {
      x: Math.floor((sx - this.panX) / this.zoom),
      y: Math.floor((sy - this.panY) / this.zoom),
    };
  }

  // ─── 렌더링 ────────────────────────────────────────────────────────────────

  render() {
    const { ctx, canvas, editor, zoom, panX, panY } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. 체커보드 배경
    if (this.showCheckerboard) this._drawCheckerboard();

    // 2. 레이어 합성 → offscreen
    if (this._dirty) {
      this._compositeToOffscreen();
      this._dirty = false;
    }

    // 3. 화면에 확대 렌더링 (픽셀아트 선명 유지)
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this._offscreen, panX, panY, editor.width * zoom, editor.height * zoom);

    // 4. 격자
    if (this.showGrid && zoom >= 4) this._drawGrid();

    // 5. 어니언 스킨
    if (this._onionSkin) this._drawOnionSkin();
  }

  _compositeToOffscreen() {
    const offCtx = this._offscreen.getContext('2d');
    offCtx.clearRect(0, 0, this._offscreen.width, this._offscreen.height);

    const { layers } = this.editor;
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (!layer.visible) continue;
      const imgData = new ImageData(new Uint8ClampedArray(layer.data), this.editor.width, this.editor.height);
      const tmp = document.createElement('canvas');
      tmp.width = this.editor.width;
      tmp.height = this.editor.height;
      tmp.getContext('2d').putImageData(imgData, 0, 0);
      offCtx.globalAlpha = layer.opacity;
      offCtx.drawImage(tmp, 0, 0);
    }
    offCtx.globalAlpha = 1;
  }

  _drawCheckerboard() {
    const { ctx, canvas, zoom, panX, panY, editor } = this;
    const sz = Math.max(4, zoom);
    const cols = Math.ceil(editor.width * zoom / sz) + 1;
    const rows = Math.ceil(editor.height * zoom / sz) + 1;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = panX + c * sz;
        const y = panY + r * sz;
        if (x >= panX + editor.width * zoom || y >= panY + editor.height * zoom) continue;
        ctx.fillStyle = (r + c) % 2 === 0 ? '#cccccc' : '#ffffff';
        ctx.fillRect(x, y, sz, sz);
      }
    }
  }

  _drawGrid() {
    const { ctx, zoom, panX, panY, editor } = this;
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();

    for (let x = 0; x <= editor.width; x++) {
      const sx = panX + x * zoom;
      ctx.moveTo(sx, panY);
      ctx.lineTo(sx, panY + editor.height * zoom);
    }
    for (let y = 0; y <= editor.height; y++) {
      const sy = panY + y * zoom;
      ctx.moveTo(panX, sy);
      ctx.lineTo(panX + editor.width * zoom, sy);
    }
    ctx.stroke();
  }

  _drawOnionSkin() {
    const { ctx, editor, zoom, panX, panY } = this;
    const prevIdx = editor.activeFrameIdx - 1;
    if (prevIdx < 0) return;

    const savedFrame = editor.activeFrameIdx;
    editor._activeFrameIdx = prevIdx;
    const imgData = editor.composite();
    editor._activeFrameIdx = savedFrame;

    const tmp = document.createElement('canvas');
    tmp.width = editor.width;
    tmp.height = editor.height;
    tmp.getContext('2d').putImageData(imgData, 0, 0);

    ctx.globalAlpha = 0.3;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, panX, panY, editor.width * zoom, editor.height * zoom);
    ctx.globalAlpha = 1;
  }

  // ─── 마우스 이벤트 ─────────────────────────────────────────────────────────

  _bindEvents() {
    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -1 : 1;
      const newZoom = Math.round(this.zoom * (delta > 0 ? 1.25 : 0.8));
      this.setZoom(newZoom);
    }, { passive: false });

    this.canvas.addEventListener('mousedown', e => {
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        this._isPanning = true;
        this._panStart = { x: e.clientX - this.panX, y: e.clientY - this.panY };
        e.preventDefault();
      }
    });

    window.addEventListener('mousemove', e => {
      if (this._isPanning) {
        this.panX = e.clientX - this._panStart.x;
        this.panY = e.clientY - this._panStart.y;
        this.render();
      }
    });

    window.addEventListener('mouseup', () => { this._isPanning = false; });
  }

  setOnionSkin(enabled) {
    this._onionSkin = enabled;
    this.render();
  }

  markDirty() {
    this._dirty = true;
    this.render();
  }

  resize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.render();
  }
}
