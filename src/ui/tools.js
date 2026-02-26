/**
 * 도구 모음: 연필, 지우개, 채우기, 스포이드, 선(Bresenham), 사각형, 원, 선택, 이동, 대칭
 */

import { floodFill } from '../algorithms/floodfill.js';

export class ToolManager {
  constructor(editor, renderer) {
    this.editor = editor;
    this.renderer = renderer;

    this.currentTool = 'pencil';
    this.brushSize = 1;
    this.primaryColor = { r: 0, g: 0, b: 0, a: 255 };
    this.secondaryColor = { r: 255, g: 255, b: 255, a: 255 };
    this.fillTolerance = 32;
    this.symmetryMode = null;   // null | 'horizontal' | 'vertical' | 'both'

    this._isDrawing = false;
    this._lastPos = null;
    this._shapeStart = null;
    this._shapePreviewData = null;

    // 선택 영역
    this.selection = null;      // { x, y, w, h }
    this._selStart = null;
    this._selCopied = null;

    this._onColorPick = null;   // 스포이드 콜백

    this._bindCanvas();
  }

  // ─── 도구 선택 ────────────────────────────────────────────────────────────

  setTool(name) {
    this.currentTool = name;
    this._isDrawing = false;
    this._shapeStart = null;
    this.editor.emit('toolChanged', name);
  }

  onColorPick(cb) { this._onColorPick = cb; }

  // ─── Canvas 이벤트 바인딩 ─────────────────────────────────────────────────

  _bindCanvas() {
    const canvas = this.renderer.canvas;

    canvas.addEventListener('mousedown', e => {
      if (e.button !== 0 && e.button !== 2) return;
      if (e.altKey) return;
      const pos = this._getPos(e);
      this._onMouseDown(pos, e.button === 2);
    });

    window.addEventListener('mousemove', e => {
      if (!this._isDrawing) return;
      const pos = this._getPos(e);
      this._onMouseMove(pos);
    });

    window.addEventListener('mouseup', e => {
      if (!this._isDrawing) return;
      const pos = this._getPos(e);
      this._onMouseUp(pos);
    });

    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  _getPos(e) {
    const rect = this.renderer.canvas.getBoundingClientRect();
    return this.renderer.screenToPixel(e.clientX - rect.left, e.clientY - rect.top);
  }

  // ─── 마우스 이벤트 핸들러 ──────────────────────────────────────────────────

  _onMouseDown(pos, isRight) {
    const color = isRight ? this.secondaryColor : this.primaryColor;
    this._isDrawing = true;
    this._lastPos = pos;

    switch (this.currentTool) {
      case 'pencil':
      case 'eraser':
        this.editor.beginStroke();
        this._drawPixels(pos.x, pos.y, pos.x, pos.y, color);
        this.renderer.markDirty();
        break;

      case 'fill':
        this._floodFill(pos.x, pos.y, color);
        this._isDrawing = false;
        break;

      case 'eyedropper':
        this._pickColor(pos.x, pos.y, isRight);
        this._isDrawing = false;
        break;

      case 'line':
      case 'rect':
      case 'circle':
        this._shapeStart = { ...pos };
        this._shapePreviewData = new Uint8ClampedArray(this.editor.activeLayer?.data || []);
        break;

      case 'select':
        this._selStart = { ...pos };
        this.selection = null;
        break;

      case 'move':
        break;
    }
  }

  _onMouseMove(pos) {
    const color = this.primaryColor;

    switch (this.currentTool) {
      case 'pencil':
      case 'eraser':
        if (this._lastPos) {
          this._stampBrushLine(this._lastPos.x, this._lastPos.y, pos.x, pos.y, color);
          this.renderer.markDirty();
        }
        this._lastPos = pos;
        break;

      case 'line':
        this._previewShape('line', this._shapeStart, pos, color);
        break;

      case 'rect':
        this._previewShape('rect', this._shapeStart, pos, color);
        break;

      case 'circle':
        this._previewShape('circle', this._shapeStart, pos, color);
        break;

      case 'select':
        if (this._selStart) {
          this.selection = this._calcRect(this._selStart, pos);
          this.renderer.markDirty();
        }
        break;
    }
  }

  _onMouseUp(pos) {
    const color = this.primaryColor;

    switch (this.currentTool) {
      case 'pencil':
      case 'eraser':
        this.editor.endStroke();
        break;

      case 'line':
      case 'rect':
      case 'circle':
        if (this._shapeStart) {
          this.editor.beginStroke();
          this._commitShape(this.currentTool, this._shapeStart, pos, color);
          this.editor.endStroke();
          this._shapeStart = null;
          this._shapePreviewData = null;
        }
        break;

      case 'select':
        if (this._selStart) {
          this.selection = this._calcRect(this._selStart, pos);
          this._selStart = null;
        }
        break;
    }

    this._isDrawing = false;
    this._lastPos = null;
    this.renderer.markDirty();
  }

  // ─── 픽셀 그리기 헬퍼 ─────────────────────────────────────────────────────

  _drawPixels(x, y, px, py, color) {
    const isEraser = this.currentTool === 'eraser';
    const sz = this.brushSize;
    const half = Math.floor(sz / 2);

    for (let dy = -half; dy < sz - half; dy++) {
      for (let dx = -half; dx < sz - half; dx++) {
        const nx = x + dx, ny = y + dy;
        if (isEraser) {
          this.editor.setPixel(nx, ny, 0, 0, 0, 0);
        } else {
          this.editor.setPixel(nx, ny, color.r, color.g, color.b, color.a);
          this._applySymmetry(nx, ny, color, isEraser);
        }
      }
    }
  }

  // 브러시 크기를 적용한 직선 (연필/지우개 드래그용)
  _stampBrushLine(x0, y0, x1, y1, color) {
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0, y = y0;
    while (true) {
      this._drawPixels(x, y, x, y, color);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }

  // Bresenham 직선 (도형 도구용, 1px)
  _drawLine(x0, y0, x1, y1, color) {
    const isEraser = this.currentTool === 'eraser';
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    let x = x0, y = y0;
    while (true) {
      if (isEraser) {
        this.editor.setPixel(x, y, 0, 0, 0, 0);
      } else {
        this.editor.setPixel(x, y, color.r, color.g, color.b, color.a);
        this._applySymmetry(x, y, color, false);
      }
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }

  _applySymmetry(x, y, color, isEraser) {
    const { width, height } = this.editor;
    const mx = width - 1 - x;
    const my = height - 1 - y;

    const set = (px, py) => {
      if (isEraser) this.editor.setPixel(px, py, 0, 0, 0, 0);
      else this.editor.setPixel(px, py, color.r, color.g, color.b, color.a);
    };

    if (this.symmetryMode === 'horizontal' || this.symmetryMode === 'both') set(mx, y);
    if (this.symmetryMode === 'vertical' || this.symmetryMode === 'both') set(x, my);
    if (this.symmetryMode === 'both') set(mx, my);
  }

  // ─── Flood Fill ────────────────────────────────────────────────────────────

  _floodFill(x, y, color) {
    const layer = this.editor.activeLayer;
    if (!layer) return;
    const dataCopy = new Uint8ClampedArray(layer.data);
    const before = new Uint8ClampedArray(layer.data);

    floodFill(dataCopy, this.editor.width, this.editor.height, x, y,
      [color.r, color.g, color.b, color.a], this.fillTolerance, false);

    // Delta 계산
    const pixels = [];
    for (let i = 0; i < this.editor.width * this.editor.height; i++) {
      const idx = i * 4;
      if (dataCopy[idx] !== before[idx] || dataCopy[idx+1] !== before[idx+1] ||
          dataCopy[idx+2] !== before[idx+2] || dataCopy[idx+3] !== before[idx+3]) {
        pixels.push({
          x: i % this.editor.width,
          y: Math.floor(i / this.editor.width),
          before: [before[idx], before[idx+1], before[idx+2], before[idx+3]],
          after: [dataCopy[idx], dataCopy[idx+1], dataCopy[idx+2], dataCopy[idx+3]],
        });
      }
    }

    layer.data = dataCopy;
    layer.dirty = true;
    this.editor._pushUndo({ type: 'fill', layerIdx: this.editor.activeLayerIdx, pixels });
    this.renderer.markDirty();
  }

  // ─── 스포이드 ──────────────────────────────────────────────────────────────

  _pickColor(x, y, isRight) {
    const composited = this.editor.composite();
    const idx = (y * this.editor.width + x) * 4;
    const color = {
      r: composited.data[idx],
      g: composited.data[idx + 1],
      b: composited.data[idx + 2],
      a: composited.data[idx + 3],
    };
    if (isRight) this.secondaryColor = color;
    else this.primaryColor = color;
    if (this._onColorPick) this._onColorPick(color, isRight);
  }

  // ─── 도형 그리기 ───────────────────────────────────────────────────────────

  _previewShape(type, start, end, color) {
    const layer = this.editor.activeLayer;
    if (!layer || !this._shapePreviewData) return;
    layer.data.set(this._shapePreviewData);
    this._commitShape(type, start, end, color, true);
    this.renderer.markDirty();
  }

  _commitShape(type, start, end, color, preview = false) {
    if (type === 'line') {
      this._drawLine(start.x, start.y, end.x, end.y, color);
    } else if (type === 'rect') {
      this._drawRect(start, end, color);
    } else if (type === 'circle') {
      this._drawCircle(start, end, color);
    }
  }

  _drawRect({ x: x0, y: y0 }, { x: x1, y: y1 }, color) {
    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
    for (let x = minX; x <= maxX; x++) {
      this.editor.setPixel(x, minY, color.r, color.g, color.b, color.a);
      this.editor.setPixel(x, maxY, color.r, color.g, color.b, color.a);
    }
    for (let y = minY + 1; y < maxY; y++) {
      this.editor.setPixel(minX, y, color.r, color.g, color.b, color.a);
      this.editor.setPixel(maxX, y, color.r, color.g, color.b, color.a);
    }
  }

  // Midpoint circle algorithm
  _drawCircle({ x: cx, y: cy }, { x: ex, y: ey }, color) {
    const r = Math.round(Math.sqrt((ex - cx) ** 2 + (ey - cy) ** 2));
    let x = 0, y = r, d = 1 - r;
    const plot = (px, py) => this.editor.setPixel(px, py, color.r, color.g, color.b, color.a);
    const points = (x, y) => {
      plot(cx+x,cy+y); plot(cx-x,cy+y); plot(cx+x,cy-y); plot(cx-x,cy-y);
      plot(cx+y,cy+x); plot(cx-y,cy+x); plot(cx+y,cy-x); plot(cx-y,cy-x);
    };
    while (x <= y) {
      points(x, y);
      x++;
      if (d < 0) d += 2*x+1;
      else { y--; d += 2*(x-y)+1; }
    }
  }

  _calcRect(start, end) {
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      w: Math.abs(end.x - start.x) + 1,
      h: Math.abs(end.y - start.y) + 1,
    };
  }

  // ─── 선택 영역 조작 ────────────────────────────────────────────────────────

  copySelection() {
    if (!this.selection) return;
    const { x, y, w, h } = this.selection;
    const layer = this.editor.activeLayer;
    if (!layer) return;
    this._selCopied = { w, h, data: new Uint8ClampedArray(w * h * 4) };
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const si = ((y + dy) * this.editor.width + (x + dx)) * 4;
        const di = (dy * w + dx) * 4;
        this._selCopied.data[di] = layer.data[si];
        this._selCopied.data[di+1] = layer.data[si+1];
        this._selCopied.data[di+2] = layer.data[si+2];
        this._selCopied.data[di+3] = layer.data[si+3];
      }
    }
  }

  pasteSelection() {
    if (!this._selCopied) return;
    const { w, h, data } = this._selCopied;
    const px = this.selection ? this.selection.x : 0;
    const py = this.selection ? this.selection.y : 0;
    this.editor.beginStroke();
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const si = (dy * w + dx) * 4;
        this.editor.setPixel(px + dx, py + dy, data[si], data[si+1], data[si+2], data[si+3]);
      }
    }
    this.editor.endStroke();
    this.renderer.markDirty();
  }

  deleteSelection() {
    if (!this.selection) return;
    const { x, y, w, h } = this.selection;
    this.editor.beginStroke();
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        this.editor.setPixel(x + dx, y + dy, 0, 0, 0, 0);
      }
    }
    this.editor.endStroke();
    this.renderer.markDirty();
  }
}
