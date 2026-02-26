/**
 * 팔레트 시스템 — LocalStorage 저장/불러오기, .hex/.pal 파일 import/export
 * 프리셋은 assets/palettes/manifest.json + .hex 파일에서 비동기 로드
 */

const STORAGE_KEY = 'pixelforge_palettes';
const PALETTES_DIR = 'assets/palettes/';

// ─── 색상 변환 헬퍼 ───────────────────────────────────────────────────────────

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

// ─── LocalStorage ─────────────────────────────────────────────────────────────

export class PaletteManager {
  constructor() {
    this._palettes = this._load();
    this._presets = [];
    this._current = null;
  }

  /** manifest.json → .hex 파일들을 fetch하여 프리셋 로드 */
  async loadPresets() {
    try {
      const res = await fetch(PALETTES_DIR + 'manifest.json');
      if (!res.ok) throw new Error(`manifest fetch failed: ${res.status}`);
      const manifest = await res.json();

      const results = await Promise.all(
        manifest.map(async (entry) => {
          const hexRes = await fetch(PALETTES_DIR + entry.file);
          if (!hexRes.ok) return null;
          const text = await hexRes.text();
          const colors = this.parseHex(text);
          if (!colors.length) return null;
          const id = 'preset_' + entry.file.replace('.hex', '');
          return { id, name: entry.name, isPreset: true, colors };
        })
      );

      this._presets = results.filter(Boolean);
    } catch (e) {
      console.warn('프리셋 로드 실패:', e);
      this._presets = [];
    }
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._palettes));
    } catch (e) {
      console.warn('LocalStorage 저장 실패:', e);
    }
  }

  getAll() {
    return [...this._presets, ...this._palettes];
  }

  getUserPalettes() { return [...this._palettes]; }
  getPresets() { return [...this._presets]; }

  create(name, colors) {
    const palette = {
      id: 'pal_' + Date.now(),
      name,
      colors: colors.map(c => typeof c === 'string' ? hexToRgb(c) : c),
      createdAt: new Date().toISOString().slice(0, 10),
      isPreset: false,
    };
    this._palettes.push(palette);
    this._save();
    return palette;
  }

  update(id, updates) {
    const idx = this._palettes.findIndex(p => p.id === id);
    if (idx === -1) return false;
    Object.assign(this._palettes[idx], updates);
    this._save();
    return true;
  }

  remove(id) {
    this._palettes = this._palettes.filter(p => p.id !== id);
    this._save();
  }

  getById(id) {
    return this._presets.find(p => p.id === id) || this._palettes.find(p => p.id === id) || null;
  }

  setCurrent(id) { this._current = this.getById(id); }
  getCurrent() { return this._current; }

  // ─── 파일 import/export ──────────────────────────────────────────────────

  /** .hex 파일 파싱 (Lospec 표준: 줄마다 HEX) */
  parseHex(text) {
    return text.split('\n')
      .map(l => l.trim())
      .filter(l => /^#?[0-9a-fA-F]{6}$/.test(l))
      .map(l => hexToRgb(l.startsWith('#') ? l : '#' + l));
  }

  /** .hex 파일 생성 */
  exportHex(palette) {
    return palette.colors.map(c => rgbToHex(c)).join('\n');
  }

  /** .pal (RIFF) 파일 파싱 (Aseprite 호환) */
  parsePal(buffer) {
    const view = new DataView(buffer);
    const colors = [];
    // RIFF header: "RIFF" + size + "PAL "
    if (view.getUint32(0, false) !== 0x52494646) return colors; // 'RIFF'
    if (view.getUint32(8, false) !== 0x50414C20) return colors; // 'PAL '
    // data chunk: "data" + size + version + numColors
    const numColors = view.getUint16(22, true);
    for (let i = 0; i < numColors; i++) {
      const offset = 24 + i * 4;
      colors.push({ r: view.getUint8(offset), g: view.getUint8(offset + 1), b: view.getUint8(offset + 2) });
    }
    return colors;
  }

  /** .pal (RIFF) 파일 생성 */
  exportPal(palette) {
    const n = palette.colors.length;
    const buffer = new ArrayBuffer(24 + n * 4);
    const view = new DataView(buffer);
    const writeStr = (offset, s) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };
    writeStr(0, 'RIFF'); view.setUint32(4, 16 + n * 4, true);
    writeStr(8, 'PAL '); writeStr(12, 'data');
    view.setUint32(16, 4 + n * 4, true); view.setUint16(20, 0x0300, true); view.setUint16(22, n, true);
    palette.colors.forEach((c, i) => {
      view.setUint8(24 + i * 4, c.r); view.setUint8(25 + i * 4, c.g); view.setUint8(26 + i * 4, c.b);
    });
    return buffer;
  }

  /** 이미지에서 색상 자동 추출 (ImageData) */
  extractFromImage(imageData) {
    const { data, width, height } = imageData;
    const seen = new Map();
    for (let i = 0; i < width * height; i++) {
      if (data[i * 4 + 3] < 128) continue;
      const key = `${data[i*4]},${data[i*4+1]},${data[i*4+2]}`;
      seen.set(key, { r: data[i*4], g: data[i*4+1], b: data[i*4+2] });
    }
    return Array.from(seen.values());
  }
}
