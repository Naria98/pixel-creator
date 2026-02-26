/**
 * UI 패널 관리: 팔레트, 레이어, 프레임, 품질 검사 경고
 */

import { rgbToHex, hexToRgb } from '../core/palette.js';
import { qualityCheck } from '../algorithms/postprocess.js';
import { rgbToLab, labDistance } from '../algorithms/kmeans.js';

export class PanelManager {
  constructor(editor, tools, paletteManager, renderer) {
    this.editor = editor;
    this.tools = tools;
    this.palette = paletteManager;
    this.renderer = renderer;

    this._initPalettePanel();
    this._initLayerPanel();
    this._initFramePanel();
    this._initToolbar();
    this._initColorPicker();
    this._initQualityPanel();

    // 이벤트 구독
    editor.on('layersChanged', () => this.renderLayers());
    editor.on('framesChanged', () => this.renderFrames());
    editor.on('colorChanged', () => this._updateColorSwatches());
    editor.on('toolChanged', (t) => this._updateToolButtons(t));
    editor.on('brushChanged', (s) => this._updateBrushSize(s));
  }

  // ─── 도구 모음 ─────────────────────────────────────────────────────────────

  _initToolbar() {
    document.querySelectorAll('[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => this.tools.setTool(btn.dataset.tool));
    });

    this.tools.onColorPick = (color) => {
      this.tools.primaryColor = color;
      this._updateColorSwatches();
    };
  }

  _updateToolButtons(tool) {
    document.querySelectorAll('[data-tool]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
  }

  _updateBrushSize(size) {
    const el = document.getElementById('brush-size');
    if (el) el.textContent = size + 'px';
  }

  // ─── 색상 선택기 ───────────────────────────────────────────────────────────

  _initColorPicker() {
    const primaryEl = document.getElementById('color-primary');
    const secondaryEl = document.getElementById('color-secondary');
    const pickerEl = document.getElementById('color-picker');

    if (primaryEl) {
      primaryEl.addEventListener('click', () => {
        if (pickerEl) {
          pickerEl.value = rgbToHex(this.tools.primaryColor);
          pickerEl._target = 'primary';
          pickerEl.click();
        }
      });
    }

    if (secondaryEl) {
      secondaryEl.addEventListener('click', () => {
        if (pickerEl) {
          pickerEl.value = rgbToHex(this.tools.secondaryColor);
          pickerEl._target = 'secondary';
          pickerEl.click();
        }
      });
    }

    if (pickerEl) {
      pickerEl.addEventListener('input', () => {
        const color = hexToRgb(pickerEl.value);
        color.a = 255;
        if (pickerEl._target === 'secondary') this.tools.secondaryColor = color;
        else this.tools.primaryColor = color;
        this._updateColorSwatches();
      });
    }

    this._updateColorSwatches();
  }

  _updateColorSwatches() {
    const primaryEl = document.getElementById('color-primary');
    const secondaryEl = document.getElementById('color-secondary');
    if (primaryEl) primaryEl.style.background = rgbToHex(this.tools.primaryColor);
    if (secondaryEl) secondaryEl.style.background = rgbToHex(this.tools.secondaryColor);
  }

  // ─── 팔레트 패널 ───────────────────────────────────────────────────────────

  _initPalettePanel() {
    const container = document.getElementById('palette-colors');
    const presetSel = document.getElementById('palette-preset');

    if (presetSel) {
      this.palette.getPresets().forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        presetSel.appendChild(opt);
      });
      presetSel.addEventListener('change', () => {
        const pal = this.palette.getById(presetSel.value);
        if (pal) { this.palette.setCurrent(pal.id); this._renderPaletteColors(pal.colors); }
      });
    }

    document.getElementById('palette-add-color')?.addEventListener('click', () => {
      const hex = prompt('HEX 코드 입력 (#RRGGBB):', '#000000');
      if (!hex) return;
      const current = this.palette.getCurrent();
      if (current && !current.isPreset) {
        current.colors.push(hexToRgb(hex));
        this.palette.update(current.id, { colors: current.colors });
        this._renderPaletteColors(current.colors);
      }
    });

    document.getElementById('palette-extract')?.addEventListener('click', () => {
      const imgData = this.editor.composite();
      const colors = this.palette.extractFromImage(imgData);
      const pal = this.palette.create('추출된 팔레트', colors);
      this.palette.setCurrent(pal.id);
      this._renderPaletteColors(pal.colors);
    });

    document.getElementById('palette-import')?.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.hex,.pal';
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        let colors;
        if (file.name.endsWith('.hex')) {
          colors = this.palette.parseHex(await file.text());
        } else {
          colors = this.palette.parsePal(await file.arrayBuffer());
        }
        const pal = this.palette.create(file.name.replace(/\.\w+$/, ''), colors);
        this.palette.setCurrent(pal.id);
        this._renderPaletteColors(pal.colors);
      };
      input.click();
    });

    document.getElementById('palette-export')?.addEventListener('click', () => {
      const current = this.palette.getCurrent();
      if (!current) return;
      const hex = this.palette.exportHex(current);
      const blob = new Blob([hex], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = current.name + '.hex';
      a.click();
    });

    document.getElementById('palette-remap')?.addEventListener('click', () => {
      this._remapToPalette();
    });

    // 초기 팔레트 (PICO-8)
    const pico8 = this.palette.getById('preset_pico8');
    if (pico8) { this.palette.setCurrent(pico8.id); this._renderPaletteColors(pico8.colors); }
  }

  /** 현재 레이어의 모든 색상을 선택된 팔레트의 가장 가까운 색상으로 교체 */
  _remapToPalette() {
    const pal = this.palette.getCurrent();
    if (!pal || !pal.colors.length) { alert('먼저 팔레트를 선택하세요.'); return; }
    const layer = this.editor.activeLayer;
    if (!layer) return;

    const labPalette = pal.colors.map(c => ({ lab: rgbToLab(c.r, c.g, c.b), rgb: c }));
    const { width, height } = this.editor;

    // LAB 매핑 캐시 (동일 RGB → 동일 결과이므로 중복 계산 방지)
    const cache = new Map();

    this.editor.beginStroke();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        if (layer.data[idx + 3] < 128) continue;

        const r = layer.data[idx], g = layer.data[idx + 1], b = layer.data[idx + 2];
        const key = (r << 16) | (g << 8) | b;

        let best;
        if (cache.has(key)) {
          best = cache.get(key);
        } else {
          const lab = rgbToLab(r, g, b);
          let minD = Infinity;
          for (const { lab: pl, rgb } of labPalette) {
            const d = labDistance(lab, pl);
            if (d < minD) { minD = d; best = rgb; }
          }
          cache.set(key, best);
        }

        if (best.r !== r || best.g !== g || best.b !== b) {
          this.editor.setPixel(x, y, best.r, best.g, best.b, 255);
        }
      }
    }
    this.editor.endStroke();
    this.renderer.markDirty();
  }

  _renderPaletteColors(colors) {
    const container = document.getElementById('palette-colors');
    if (!container) return;
    container.innerHTML = '';
    colors.forEach(color => {
      const swatch = document.createElement('div');
      swatch.className = 'palette-swatch';
      swatch.style.background = rgbToHex(color);
      swatch.title = rgbToHex(color);
      swatch.addEventListener('click', (e) => {
        if (e.shiftKey) this.tools.secondaryColor = { ...color, a: 255 };
        else this.tools.primaryColor = { ...color, a: 255 };
        this._updateColorSwatches();
      });
      container.appendChild(swatch);
    });
  }

  // ─── 레이어 패널 ───────────────────────────────────────────────────────────

  _initLayerPanel() {
    document.getElementById('layer-add')?.addEventListener('click', () => {
      this.editor.addLayer();
    });

    document.getElementById('layer-delete')?.addEventListener('click', () => {
      this.editor.removeLayer(this.editor.activeLayerIdx);
    });

    document.getElementById('layer-merge')?.addEventListener('click', () => {
      this.editor.mergeDown(this.editor.activeLayerIdx);
    });

    this.renderLayers();
  }

  renderLayers() {
    const container = document.getElementById('layer-list');
    if (!container) return;
    container.innerHTML = '';

    const layers = this.editor.layers;
    layers.forEach((layer, idx) => {
      const item = document.createElement('div');
      item.className = 'layer-item' + (idx === this.editor.activeLayerIdx ? ' active' : '');
      item.draggable = true;

      item.innerHTML = `
        <button class="layer-vis" title="가시성">${layer.visible ? '👁' : '🚫'}</button>
        <span class="layer-name">${layer.name}</span>
        <input class="layer-opacity" type="range" min="0" max="100" value="${Math.round(layer.opacity * 100)}" title="불투명도">
        <span class="layer-opacity-val">${Math.round(layer.opacity * 100)}%</span>
      `;

      item.querySelector('.layer-vis').addEventListener('click', (e) => {
        e.stopPropagation();
        this.editor.toggleLayerVisibility(idx);
      });

      item.querySelector('.layer-opacity').addEventListener('input', (e) => {
        const val = Number(e.target.value) / 100;
        this.editor.setLayerOpacity(idx, val);
        item.querySelector('.layer-opacity-val').textContent = e.target.value + '%';
      });

      item.addEventListener('click', () => this.editor.setActiveLayer(idx));

      // Drag & Drop
      item.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', idx); });
      item.addEventListener('dragover', e => e.preventDefault());
      item.addEventListener('drop', e => {
        e.preventDefault();
        const from = parseInt(e.dataTransfer.getData('text/plain'));
        this.editor.moveLayer(from, idx);
      });

      container.appendChild(item);
    });
  }

  // ─── 프레임 패널 ───────────────────────────────────────────────────────────

  _initFramePanel() {
    document.getElementById('frame-add')?.addEventListener('click', () => this.editor.addFrame());
    document.getElementById('frame-dup')?.addEventListener('click', () => this.editor.duplicateFrame(this.editor.activeFrameIdx));
    document.getElementById('frame-del')?.addEventListener('click', () => this.editor.removeFrame(this.editor.activeFrameIdx));

    document.getElementById('fps-slider')?.addEventListener('input', e => {
      this.editor.fps = Number(e.target.value);
      const el = document.getElementById('fps-val');
      if (el) el.textContent = e.target.value;
    });

    const playBtn = document.getElementById('frame-play');
    let playTimer = null;
    playBtn?.addEventListener('click', () => {
      if (playTimer) {
        clearInterval(playTimer);
        playTimer = null;
        playBtn.textContent = '▶ 재생';
      } else {
        playBtn.textContent = '⏹ 정지';
        playTimer = setInterval(() => {
          const next = (this.editor.activeFrameIdx + 1) % this.editor.frames.length;
          this.editor.setActiveFrame(next);
        }, 1000 / this.editor.fps);
      }
    });

    document.getElementById('onion-toggle')?.addEventListener('change', e => {
      this.renderer.setOnionSkin(e.target.checked);
    });

    this.renderFrames();
  }

  renderFrames() {
    const container = document.getElementById('frame-list');
    if (!container) return;
    container.innerHTML = '';

    this.editor.frames.forEach((frame, idx) => {
      const item = document.createElement('div');
      item.className = 'frame-item' + (idx === this.editor.activeFrameIdx ? ' active' : '');

      // 섬네일 렌더링
      const thumb = document.createElement('canvas');
      thumb.width = 48; thumb.height = 48;
      const savedFrame = this.editor.activeFrameIdx;
      this.editor._activeFrameIdx = idx;
      const imgData = this.editor.composite();
      this.editor._activeFrameIdx = savedFrame;

      const thumbCtx = thumb.getContext('2d');
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = this.editor.width; tmpCanvas.height = this.editor.height;
      tmpCanvas.getContext('2d').putImageData(imgData, 0, 0);
      thumbCtx.imageSmoothingEnabled = false;
      thumbCtx.drawImage(tmpCanvas, 0, 0, 48, 48);

      item.appendChild(thumb);
      const label = document.createElement('span');
      label.textContent = idx + 1;
      item.appendChild(label);

      item.addEventListener('click', () => this.editor.setActiveFrame(idx));
      container.appendChild(item);
    });
  }

  // ─── 품질 검사 패널 ────────────────────────────────────────────────────────

  _initQualityPanel() {
    document.getElementById('quality-check')?.addEventListener('click', () => {
      const imgData = this.editor.composite();
      const currentPalette = this.palette.getCurrent();
      const issues = qualityCheck(imgData, currentPalette?.colors || []);
      this._renderQualityIssues(issues);
    });
  }

  _renderQualityIssues(issues) {
    const panel = document.getElementById('quality-results');
    if (!panel) return;

    const lines = [];
    if (issues.lonelyPixels.length > 0) lines.push(`⚠ 고립 픽셀: ${issues.lonelyPixels.length}개`);
    if (issues.banding.length > 0) lines.push(`⚠ 색상 띠(Banding): ${issues.banding.length}곳`);
    if (issues.extraColors.length > 0) lines.push(`⚠ 팔레트 초과 색상: ${issues.extraColors.length}개`);
    if (lines.length === 0) lines.push('✅ 품질 검사 통과');

    panel.innerHTML = lines.map(l => `<div class="quality-issue">${l}</div>`).join('');
  }
}
