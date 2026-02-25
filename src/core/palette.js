/**
 * 팔레트 시스템 — LocalStorage 저장/불러오기, .hex/.pal 파일 import/export
 */

const STORAGE_KEY = 'pixelforge_palettes';

// ─── 프리셋 팔레트 ────────────────────────────────────────────────────────────

export const PRESETS = {
  gameboy: {
    id: 'preset_gameboy',
    name: 'Game Boy',
    isPreset: true,
    colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'].map(hexToRgb),
  },
  nes: {
    id: 'preset_nes',
    name: 'NES',
    isPreset: true,
    colors: [
      '#7c7c7c','#0000fc','#0000bc','#4428bc','#940084','#a80020','#a81000','#881400',
      '#503000','#007800','#006800','#005800','#004058','#000000','#000000','#000000',
      '#bcbcbc','#0078f8','#0058f8','#6844fc','#d800cc','#e40058','#f83800','#e45c10',
      '#ac7c00','#00b800','#00a800','#00a844','#008888','#000000','#000000','#000000',
      '#f8f8f8','#3cbcfc','#6888fc','#9878f8','#f878f8','#f85898','#f87858','#fca044',
      '#f8b800','#b8f818','#58d854','#58f898','#00e8d8','#787878','#000000','#000000',
      '#fcfcfc','#a4e4fc','#b8b8f8','#d8b8f8','#f8b8f8','#f8a4c0','#f0d0b0','#fce0a8',
      '#f8d878','#d8f878','#b8f8b8','#b8f8d8','#00fcfc','#f8d8f8','#000000','#000000',
    ].map(hexToRgb),
  },
  cga: {
    id: 'preset_cga',
    name: 'CGA',
    isPreset: true,
    colors: [
      '#000000','#0000aa','#00aa00','#00aaaa',
      '#aa0000','#aa00aa','#aa5500','#aaaaaa',
      '#555555','#5555ff','#55ff55','#55ffff',
      '#ff5555','#ff55ff','#ffff55','#ffffff',
    ].map(hexToRgb),
  },
  pico8: {
    id: 'preset_pico8',
    name: 'PICO-8',
    isPreset: true,
    colors: [
      '#000000','#1d2b53','#7e2553','#008751',
      '#ab5236','#5f574f','#c2c3c7','#fff1e8',
      '#ff004d','#ffa300','#ffec27','#00e436',
      '#29adff','#83769c','#ff77a8','#ffccaa',
    ].map(hexToRgb),
  },
  mono: {
    id: 'preset_mono',
    name: '흑백',
    isPreset: true,
    colors: ['#000000', '#ffffff'].map(hexToRgb),
  },
};

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
    this._current = null;
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
    return [...Object.values(PRESETS), ...this._palettes];
  }

  getUserPalettes() { return [...this._palettes]; }
  getPresets() { return Object.values(PRESETS); }

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
    return PRESETS[id.replace('preset_', '')] || this._palettes.find(p => p.id === id) || null;
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
