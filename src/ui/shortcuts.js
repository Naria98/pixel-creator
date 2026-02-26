/**
 * 전체 단축키 관리
 * B — 연필  E — 지우개  G — 채우기  I — 스포이드  L — 선  M — 선택
 * Ctrl+Z — 실행취소  Ctrl+Y — 다시실행
 * Ctrl+C / V — 복사 / 붙여넣기
 * [ / ] — 브러시 크기 조절
 */

export class ShortcutManager {
  constructor(editor, tools) {
    this.editor = editor;
    this.tools = tools;
    this._handlers = {};
    this._active = true;
    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', e => {
      if (!this._active) return;
      // 텍스트 입력 중이면 무시
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const key = this._normalize(e);
      const handler = this._handlers[key];
      if (handler) { e.preventDefault(); handler(e); }
    });
  }

  _normalize(e) {
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('ctrl');
    if (e.shiftKey) parts.push('shift');
    if (e.altKey) parts.push('alt');

    // e.code로 물리적 키 위치 기반 매칭 (한국어 등 비라틴 입력기 지원)
    // e.key는 입력기 상태에 따라 'z' 대신 'ㅋ' 등을 반환해 매칭 실패
    let keyName;
    if (e.code && e.code.startsWith('Key')) {
      keyName = e.code.slice(3).toLowerCase();   // 'KeyB' → 'b'
    } else if (e.code && e.code.startsWith('Digit')) {
      keyName = e.code.slice(5);                  // 'Digit0' → '0'
    } else {
      keyName = e.key.toLowerCase();              // '[', 'delete', 'backspace' 등
    }

    parts.push(keyName);
    return parts.join('+');
  }

  register(key, handler) {
    this._handlers[key.toLowerCase()] = handler;
    return this;
  }

  disable() { this._active = false; }
  enable() { this._active = true; }

  setup() {
    // 도구 선택
    this.register('b', () => this.tools.setTool('pencil'));
    this.register('e', () => this.tools.setTool('eraser'));
    this.register('g', () => this.tools.setTool('fill'));
    this.register('i', () => this.tools.setTool('eyedropper'));
    this.register('l', () => this.tools.setTool('line'));
    this.register('m', () => this.tools.setTool('select'));
    this.register('r', () => this.tools.setTool('rect'));
    this.register('o', () => this.tools.setTool('circle'));
    this.register('v', () => this.tools.setTool('move'));

    // Undo/Redo
    this.register('ctrl+z', () => this.editor.undo());
    this.register('ctrl+y', () => this.editor.redo());
    this.register('ctrl+shift+z', () => this.editor.redo());

    // 복사/붙여넣기
    this.register('ctrl+c', () => this.tools.copySelection());
    this.register('ctrl+v', () => this.tools.pasteSelection());
    this.register('delete', () => this.tools.deleteSelection());
    this.register('backspace', () => this.tools.deleteSelection());

    // 브러시 크기
    this.register('[', () => {
      this.tools.brushSize = Math.max(1, this.tools.brushSize - 1);
      this.editor.emit('brushChanged', this.tools.brushSize);
    });
    this.register(']', () => {
      this.tools.brushSize = Math.min(16, this.tools.brushSize + 1);
      this.editor.emit('brushChanged', this.tools.brushSize);
    });

    // 확대/축소
    this.register('ctrl+=', () => {
      if (this._renderer) this._renderer.setZoom(this._renderer.zoom + 1);
    });
    this.register('ctrl+-', () => {
      if (this._renderer) this._renderer.setZoom(this._renderer.zoom - 1);
    });
    this.register('ctrl+0', () => {
      if (this._renderer) this._renderer.fitToCanvas();
    });

    // 색상 교환
    this.register('x', () => {
      const tmp = { ...this.tools.primaryColor };
      this.tools.primaryColor = { ...this.tools.secondaryColor };
      this.tools.secondaryColor = tmp;
      this.editor.emit('colorChanged');
    });

    return this;
  }

  setRenderer(renderer) {
    this._renderer = renderer;
    return this;
  }
}
