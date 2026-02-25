/**
 * blockdetect.js
 * 업스케일된 픽셀아트 이미지에서 실제 픽셀 블록 크기를 자동 감지하고,
 * 해당 블록 크기로 이미지를 진짜 픽셀 크기로 다운샘플링합니다.
 *
 * 핵심 아이디어:
 *   업스케일된 픽셀아트는 N×N 단색 블록의 반복 구조를 가집니다.
 *   블록 경계(엣지)는 정확히 주기 N마다 나타나므로,
 *   colEnergy/rowEnergy 배열의 자기상관(autocorrelation)에서
 *   가장 작은 유의미한 피크 = 진짜 블록 크기 N을 찾습니다.
 */

/**
 * 이미지에서 픽셀 블록 크기를 자동으로 감지합니다.
 * @param {ImageData} imageData
 * @returns {{ blockSize: number, confidence: number, candidates: Array<{size:number,score:number}> }}
 */
export function detectBlockSize(imageData) {
  const { data, width, height } = imageData;

  // 1. 그레이스케일 변환
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const a = data[i * 4 + 3];
    gray[i] = a > 0
      ? 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
      : 0;
  }

  // 2. 수평/수직 엣지 에너지 계산
  // colEnergy[x] : 열 x와 x+1 사이의 색상 차이 (모든 행 합산)
  const colEnergy = new Float32Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      colEnergy[x] += Math.abs(gray[y * width + x + 1] - gray[y * width + x]);
    }
  }

  // rowEnergy[y] : 행 y와 y+1 사이의 색상 차이 (모든 열 합산)
  const rowEnergy = new Float32Array(height);
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width; x++) {
      rowEnergy[y] += Math.abs(gray[(y + 1) * width + x] - gray[y * width + x]);
    }
  }

  const maxBlockSize = Math.min(Math.floor(width / 4), Math.floor(height / 4), 64);
  if (maxBlockSize < 2) return { blockSize: 1, confidence: 0, candidates: [] };

  // 3. 자기상관(autocorrelation) 계산 후 첫 번째 유의미한 피크 탐색
  const hPeak = findFundamentalPeriod(colEnergy, width, maxBlockSize);
  const vPeak = findFundamentalPeriod(rowEnergy, height, maxBlockSize);

  // 4. 수평/수직 결과 통합
  let blockSize, confidence;
  if (hPeak && vPeak) {
    // 둘 다 감지된 경우: GCD로 공통 주기 추출
    const g = gcd(hPeak.period, vPeak.period);
    // GCD가 너무 작으면(=1) 더 신뢰도 높은 쪽 채택
    if (g >= 2) {
      blockSize = g;
      confidence = (hPeak.confidence + vPeak.confidence) / 2;
    } else {
      const best = hPeak.confidence >= vPeak.confidence ? hPeak : vPeak;
      blockSize = best.period;
      confidence = best.confidence * 0.6; // 둘이 불일치하면 신뢰도 감소
    }
  } else if (hPeak) {
    blockSize = hPeak.period;
    confidence = hPeak.confidence * 0.7;
  } else if (vPeak) {
    blockSize = vPeak.period;
    confidence = vPeak.confidence * 0.7;
  } else {
    blockSize = 1;
    confidence = 0;
  }

  // 5. 상위 후보 목록 생성 (UI 표시용)
  const candidates = buildCandidateList(colEnergy, rowEnergy, width, height, maxBlockSize);

  return {
    blockSize,
    confidence: Math.min(1, Math.max(0, confidence)),
    candidates,
  };
}

/**
 * 에너지 배열에서 자기상관을 이용해 기본 주기(블록 크기)를 찾습니다.
 * 핵심: 완전한 업스케일 신호에서 autoCorr[b] = 0 (b가 주기의 약수가 아닌 경우),
 * autoCorr[주기] = 높음 → 가장 작은 유의미한 피크 = 기본 주기.
 */
function findFundamentalPeriod(energy, n, maxLag) {
  // 자기상관 계산
  const ac = new Float32Array(maxLag + 1);
  for (let lag = 2; lag <= maxLag; lag++) {
    let sum = 0;
    const limit = n - 1 - lag;
    for (let x = 0; x <= limit; x++) {
      sum += energy[x] * energy[x + lag];
    }
    ac[lag] = sum;
  }

  const maxAC = ac.reduce((m, v) => Math.max(m, v), 0);
  if (maxAC < 1e-6) return null;

  // 유의미한 피크 탐색: maxAC의 20% 이상이면서 로컬 최대
  const threshold = 0.20 * maxAC;
  for (let lag = 2; lag <= maxLag; lag++) {
    if (ac[lag] < threshold) continue;
    const prev = ac[lag - 1] ?? 0;
    const next = ac[lag + 1] ?? 0;
    if (ac[lag] >= prev && ac[lag] >= next) {
      return { period: lag, confidence: ac[lag] / maxAC };
    }
  }
  return null;
}

/** 최대공약수 */
function gcd(a, b) {
  while (b) { const t = b; b = a % b; a = t; }
  return a;
}

/**
 * UI에 표시할 후보 블록 크기 목록을 생성합니다.
 * 각 후보의 점수 = 경계 에너지 집중도 (위상 최적화 포함).
 */
function buildCandidateList(colEnergy, rowEnergy, width, height, maxBlockSize) {
  const candidates = [];
  for (let b = 2; b <= maxBlockSize; b++) {
    const hScore = boundaryConcentration(colEnergy, b, width);
    const vScore = boundaryConcentration(rowEnergy, b, height);
    candidates.push({ size: b, score: (hScore + vScore) / 2 });
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, 8);
}

/**
 * 에너지가 b 간격 경계 위치에 얼마나 집중되어 있는지를 0~1로 반환합니다.
 * 모든 위상 오프셋(0..b-1)을 시도해 최적 위상 선택.
 */
function boundaryConcentration(energy, b, n) {
  let totalEnergy = 0;
  for (let i = 0; i < n - 1; i++) totalEnergy += energy[i];
  if (totalEnergy < 1e-6) return 0;

  let bestBoundaryEnergy = 0;
  for (let phi = 0; phi < b; phi++) {
    let sum = 0;
    for (let pos = phi; pos < n - 1; pos += b) sum += energy[pos];
    if (sum > bestBoundaryEnergy) bestBoundaryEnergy = sum;
  }

  const numBoundaries = Math.max(1, Math.floor((n - 1) / b));
  // 정규화: (경계 위치 평균 에너지) / (전체 평균 에너지) / b → 올바른 b면 ≈ 1.0
  return (bestBoundaryEnergy * (n - 1)) / (numBoundaries * totalEnergy * b);
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * 업스케일된 이미지를 진짜 픽셀 크기로 다운샘플링합니다.
 *
 * @param {ImageData} imageData  - 원본 (업스케일된) 이미지
 * @param {number}    blockSize  - 감지된 또는 사용자가 지정한 블록 크기
 * @param {'mode'|'median'|'average'} method - 블록 내 색상 추출 방식
 *   - 'mode'    : 최빈값 (권장 — JPEG 아티팩트에 강함, 깨끗한 색상 출력)
 *   - 'median'  : 중앙값 (부드러운 그라디언트 이미지에 적합)
 *   - 'average' : 평균 (선형 혼합)
 * @returns {ImageData}
 */
export function truePixelize(imageData, blockSize, method = 'mode') {
  const { data, width, height } = imageData;
  const b = Math.max(1, Math.round(blockSize));
  const outW = Math.max(1, Math.round(width / b));
  const outH = Math.max(1, Math.round(height / b));
  const outData = new Uint8ClampedArray(outW * outH * 4);

  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      const x0 = ox * b;
      const y0 = oy * b;
      const x1 = Math.min(x0 + b, width);
      const y1 = Math.min(y0 + b, height);

      // 블록 경계부 안티앨리어싱 픽셀 제외 (b ≥ 4일 때 1픽셀 여백)
      // → 인접 블록의 색상이 오염되어 외곽선이 두꺼워지는 현상 방지
      const margin = b >= 4 ? 1 : 0;
      const sx0 = Math.min(x0 + margin, x1 - 1);
      const sy0 = Math.min(y0 + margin, y1 - 1);
      const sx1 = Math.max(x1 - margin, sx0 + 1);
      const sy1 = Math.max(y1 - margin, sy0 + 1);

      // 블록 내 불투명 픽셀 수집
      const rs = [], gs = [], bs = [];
      let total = 0;

      for (let y = sy0; y < sy1; y++) {
        for (let x = sx0; x < sx1; x++) {
          const i = (y * width + x) * 4;
          total++;
          if (data[i + 3] > 128) {
            rs.push(data[i]);
            gs.push(data[i + 1]);
            bs.push(data[i + 2]);
          }
        }
      }

      const oi = (oy * outW + ox) * 4;
      if (rs.length === 0) { outData[oi + 3] = 0; continue; }

      if (method === 'mode') {
        // 5비트(32단계)로 양자화 → 최빈 색상 키 추출 → 원본 픽셀 평균으로 정밀 복원
        const colorCount = new Map();
        for (let k = 0; k < rs.length; k++) {
          const key = (Math.round(rs[k] / 8) << 16)
                    | (Math.round(gs[k] / 8) << 8)
                    |  Math.round(bs[k] / 8);
          colorCount.set(key, (colorCount.get(key) || 0) + 1);
        }
        let maxCnt = 0, modeKey = 0;
        for (const [key, cnt] of colorCount) {
          if (cnt > maxCnt) { maxCnt = cnt; modeKey = key; }
        }
        const rq = ((modeKey >> 16) & 0xff) * 8;
        const gq = ((modeKey >>  8) & 0xff) * 8;
        const bq =  (modeKey        & 0xff) * 8;

        let rSum = 0, gSum = 0, bSum = 0, cnt = 0;
        for (let k = 0; k < rs.length; k++) {
          if (Math.abs(rs[k] - rq) <= 12 && Math.abs(gs[k] - gq) <= 12 && Math.abs(bs[k] - bq) <= 12) {
            rSum += rs[k]; gSum += gs[k]; bSum += bs[k]; cnt++;
          }
        }
        outData[oi]     = cnt > 0 ? Math.round(rSum / cnt) : rq;
        outData[oi + 1] = cnt > 0 ? Math.round(gSum / cnt) : gq;
        outData[oi + 2] = cnt > 0 ? Math.round(bSum / cnt) : bq;

      } else if (method === 'median') {
        rs.sort((a, b) => a - b);
        gs.sort((a, b) => a - b);
        bs.sort((a, b) => a - b);
        const mid = Math.floor(rs.length / 2);
        outData[oi]     = rs[mid];
        outData[oi + 1] = gs[mid];
        outData[oi + 2] = bs[mid];

      } else {
        // average
        const len = rs.length;
        outData[oi]     = Math.round(rs.reduce((s, v) => s + v, 0) / len);
        outData[oi + 1] = Math.round(gs.reduce((s, v) => s + v, 0) / len);
        outData[oi + 2] = Math.round(bs.reduce((s, v) => s + v, 0) / len);
      }

      // 불투명 픽셀이 블록의 절반 이상이면 불투명, 그렇지 않으면 투명
      outData[oi + 3] = rs.length > total / 2 ? 255 : 0;
    }
  }

  return new ImageData(outData, outW, outH);
}
