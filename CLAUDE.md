# PixelForge — Claude Code 프로젝트 문서

## 프로젝트 개요

웹 기반 픽셀아트 변환기 + 에디터. 이미지를 픽셀아트로 자동 변환하고 직접 편집 후 게임 에셋으로 export.

- **기술 스택**: HTML5 Canvas + Vanilla JavaScript + Web Worker + gif.js
- **플랫폼**: 웹 브라우저 (데스크탑 전용)

---

## 권장 폴더 구조

```
pixel-forge/
├── CLAUDE.md
├── index.html
├── src/
│   ├── core/
│   │   ├── converter.js       # 변환 엔진 메인
│   │   ├── editor.js          # 픽셀 에디터 메인
│   │   └── palette.js         # 팔레트 시스템
│   ├── algorithms/
│   │   ├── sobel.js           # Sobel 엣지 감지
│   │   ├── kmeans.js          # LAB K-Means++
│   │   ├── dithering.js       # Floyd-Steinberg / Atkinson / Bayer
│   │   ├── floodfill.js       # 배경 제거 (Queue 방식)
│   │   └── postprocess.js     # AA, Sel-Out, Lonely Pixel, Banding
│   ├── workers/
│   │   └── pixelWorker.js     # Web Worker (무거운 연산)
│   └── ui/
│       ├── canvas.js          # Canvas 렌더링 / 레이어 합성
│       ├── tools.js           # 도구 모음
│       ├── panels.js          # UI 패널 (팔레트, 레이어, 프레임)
│       └── shortcuts.js       # 단축키 관리
└── assets/
    └── palettes/              # 프리셋 팔레트 .hex 파일
```

---

## 작업 계획 (Phase별)

### Phase 1 — 변환 엔진 (우선순위: 최고)

**목표**: 이미지 → 픽셀아트 자동 변환 파이프라인 구축

**구현 파일**:
- `src/algorithms/sobel.js` — Sobel 엣지 감지 + Otsu's Method 임계값
- `src/algorithms/kmeans.js` — RGB→LAB 변환, K-Means++ 색상 양자화
- `src/algorithms/dithering.js` — Bayer / Floyd-Steinberg / Atkinson 3종
- `src/algorithms/floodfill.js` — Queue 기반 Flood Fill (재귀 금지)
- `src/algorithms/postprocess.js` — Anti-Aliasing, Selective Outlining, Lonely Pixel 제거, Banding 방지
- `src/workers/pixelWorker.js` — Web Worker로 무거운 연산 분리
- `src/core/converter.js` — 위 알고리즘 조합, 변환 파이프라인 오케스트레이션
- `index.html` — 이미지 업로드 → 변환 → Canvas 미리보기

**주요 알고리즘 순서**:
1. Sobel 필터로 경계선 감지 → Otsu's Method 임계값
2. N×N 블록 → 1픽셀 다운샘플링 (엣지 방향 보존)
3. RGB → LAB 색공간, 10% 랜덤 샘플링, K-Means++ 팔레트 추출
4. 전체 픽셀 → 팔레트 매핑 (LAB ΔE 색상 거리)
5. 디더링 적용 (선택)
6. 후처리: AA → Selective Outlining → Lonely Pixel 제거 → Banding 방지
7. 배경 투명화 (마법봉 / 외곽 자동 제거)

**주의사항**:
- Flood Fill은 반드시 Queue 기반 반복 방식 (재귀 스택 오버플로우 방지)
- Web Worker 분리로 메인 스레드 블로킹 방지
- LAB K-Means 성능: 전체 픽셀의 10%만 샘플링

---

### Phase 2 — 캔버스 & 기본 에디터

**목표**: 픽셀 단위 편집 도구 구현

**구현 파일**:
- `src/ui/canvas.js` — Canvas 렌더링, 확대/축소, 격자 표시
- `src/ui/tools.js` — 연필, 지우개, 채우기, 스포이드
- `src/core/editor.js` — 에디터 상태 관리, Delta 방식 Undo/Redo

**핵심 구현**:
- Delta 방식 Undo/Redo 50단계 (전체 Canvas가 아닌 변경 픽셀만 저장)
- Queue 기반 Flood Fill 채우기 도구
- 확대/축소 (최대 800%), 격자 ON/OFF

---

### Phase 3 — 고급 도구

**목표**: 선/도형/선택 도구 + 단축키 완성

**구현 파일**:
- `src/ui/tools.js` — 선(Bresenham), 사각형, 원, 선택영역, 이동, 대칭 모드
- `src/ui/shortcuts.js` — 전체 단축키 관리

**단축키 목록**:
```
B — 연필       E — 지우개     G — 채우기
I — 스포이드   L — 선         M — 선택
Ctrl+Z — 실행취소    Ctrl+Y — 다시실행
Ctrl+C / V — 복사 / 붙여넣기
[ / ] — 브러시 크기 조절
```

---

### Phase 4 — 레이어 시스템

**목표**: 다중 레이어 편집 환경 구축

**구현 파일**:
- `src/ui/panels.js` — 레이어 패널 UI (추가/삭제/순서/불투명도/토글)
- `src/ui/canvas.js` — Dirty Flag 기반 레이어 합성 최적화

**레이어 규칙**:
- 변환 결과는 자동으로 별도 레이어 삽입 (원본 보존)
- Dirty Flag: 변경된 레이어만 재합성 (성능 최적화)
- Merge Down 기능

---

### Phase 5 — 팔레트 시스템

**목표**: 색상 관리 시스템 구축

**구현 파일**:
- `src/core/palette.js` — 팔레트 로직, LocalStorage 저장/불러오기
- `src/ui/panels.js` — 팔레트 패널 UI
- `assets/palettes/` — 프리셋 파일 (Game Boy, NES, CGA, PICO-8, 흑백)

**지원 포맷**:
- `.hex` — 줄마다 HEX 코드 (Lospec 표준)
- `.pal` — RIFF 형식 (Aseprite 호환)
- 클립보드 HEX 목록 복사/붙여넣기

**LocalStorage 데이터 구조**:
```json
{
  "palettes": [
    {
      "id": "uuid-1234",
      "name": "내 첫 팔레트",
      "colors": ["#1a1c2c", "#5d275d"],
      "createdAt": "2026-02-25",
      "isPreset": false
    }
  ]
}
```

---

### Phase 6 — 애니메이션 & 내보내기

**목표**: 프레임 기반 애니메이션 + 다양한 export 포맷

**구현 파일**:
- `src/ui/panels.js` — 프레임 패널 (추가/복제/삭제/순서/FPS/어니언 스킨)
- `src/core/editor.js` — GIF 내보내기 (gif.js 라이브러리 연동)

**내보내기 포맷**:
- 단일 PNG (투명 배경)
- 스프라이트시트 (가로/세로/그리드, Unity/Godot/RPG Maker 호환)
- 애니메이션 GIF (gif.js MIT)

---

### Phase 7 — 품질 검사 & UI 다듬기

**목표**: 자동 품질 검사 및 전체 UI 완성도 향상

**구현 파일**:
- `src/algorithms/postprocess.js` — 자동 감지 로직
- `src/ui/panels.js` — 경고 표시 UI

**자동 감지 항목**:
| 항목 | 감지 방법 |
|------|---------|
| 고립 픽셀 (Lonely Pixel) | 주변 4방향 모두 다른 색인 픽셀 |
| 색상 띠 (Banding) | 동일 명도 픽셀 3개 이상 연속 |
| 지저분한 선 (Dirty Line) | 외곽선 픽셀 연속성 체크 |
| 색상 초과 | 팔레트 초과 색상 수 표시 |

---

## 구현 리스크 및 대책

| 기능 | 위험도 | 핵심 해결책 |
|------|--------|------------|
| Canvas 대용량 처리 | 중간 | Web Worker 분리 |
| Sobel 임계값 튜닝 | 중간 | Otsu's Method + 수동 슬라이더 |
| LAB K-Means 성능 | 높음 | 10% 랜덤 샘플링 + K-Means++ |
| Floyd-Steinberg 속도 | 중간 | 순차 처리 필수, 진행 표시바 |
| Undo/Redo 메모리 | 중간 | Delta 방식 (변경 픽셀만 저장) |
| Flood Fill 스택 오버플로우 | 중간 | Queue 기반 반복 방식 (재귀 금지) |
| GIF 인코딩 | 낮음 | gif.js 오픈소스 (MIT) |
| 모바일 지원 | 높음 | 에디터는 데스크탑 전용으로 제한 |

---

## 개발 시작 프롬프트

**Phase 1:**
```
CLAUDE.md를 읽고, Phase 1 변환 엔진부터 시작해줘.
src/algorithms/ 폴더에 sobel.js, kmeans.js, dithering.js, floodfill.js, postprocess.js를 구현하고
src/core/converter.js에서 이를 조합해 Web Worker로 실행되도록 해줘.
index.html에서 이미지 업로드 → 변환 → Canvas 미리보기까지 테스트할 수 있게 해줘.
```

**Phase 2:**
```
Phase 1 변환 엔진 위에 픽셀 에디터를 붙여줘.
연필, 지우개, 채우기(Queue 방식 Flood Fill), 스포이드 도구와
확대/축소, 격자 표시, Delta 방식 Undo/Redo 50단계를 구현해줘.
```

**Phase 3:**
```
Phase 2에 고급 도구를 추가해줘.
선(Bresenham), 사각형, 원, 선택영역(이동/복사/삭제), 대칭 모드와
전체 단축키(shortcuts.js)를 구현해줘.
```

**Phase 4:**
```
레이어 시스템을 구현해줘.
레이어 추가/삭제/순서변경/불투명도/병합을 지원하고
Dirty Flag 방식으로 변경된 레이어만 재합성하도록 최적화해줘.
```

**Phase 5:**
```
팔레트 시스템을 구현해줘.
프리셋 팔레트(Game Boy, NES, CGA, PICO-8, 흑백)와
사용자 커스텀 팔레트를 LocalStorage에 저장/불러오기,
.hex/.pal 파일 가져오기·내보내기를 구현해줘.
```

**Phase 6:**
```
프레임 시스템과 내보내기를 구현해줘.
프레임 추가/복제/삭제, FPS 설정, 어니언 스킨과
PNG / 스프라이트시트 / GIF(gif.js) 내보내기를 구현해줘.
```

**Phase 7:**
```
품질 검사 자동화와 UI를 다듬어줘.
Lonely Pixel, Banding, Dirty Line 자동 감지 및 경고 표시,
전체 레이아웃 정리와 반응형 보완을 해줘.
```
