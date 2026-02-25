/**
 * Queue 기반 Flood Fill — 재귀 방식 절대 금지 (스택 오버플로우 방지)
 * 배경 투명화, 채우기 도구에 사용
 */

/**
 * @param {Uint8ClampedArray} data  - ImageData.data
 * @param {number} width
 * @param {number} height
 * @param {number} startX
 * @param {number} startY
 * @param {number[]} fillColor  - [r, g, b, a]
 * @param {number} tolerance    - 색상 허용 오차 (0~255)
 * @param {boolean} transparent - true면 해당 영역을 투명으로 처리
 */
export function floodFill(data, width, height, startX, startY, fillColor, tolerance = 32, transparent = false) {
  const startIdx = (startY * width + startX) * 4;
  const targetR = data[startIdx];
  const targetG = data[startIdx + 1];
  const targetB = data[startIdx + 2];
  const targetA = data[startIdx + 3];

  const [fillR, fillG, fillB, fillA] = fillColor;

  // 이미 같은 색이면 스킵
  if (!transparent && fillR === targetR && fillG === targetG && fillB === targetB && fillA === targetA) return;

  const visited = new Uint8Array(width * height);
  const queue = [];
  queue.push(startX, startY);

  let head = 0;
  while (head < queue.length) {
    const x = queue[head++];
    const y = queue[head++];

    if (x < 0 || x >= width || y < 0 || y >= height) continue;

    const idx = y * width + x;
    if (visited[idx]) continue;

    const i = idx * 4;
    if (!colorMatch(data[i], data[i + 1], data[i + 2], data[i + 3], targetR, targetG, targetB, targetA, tolerance)) continue;

    visited[idx] = 1;

    if (transparent) {
      data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0;
    } else {
      data[i] = fillR; data[i + 1] = fillG; data[i + 2] = fillB; data[i + 3] = fillA;
    }

    queue.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
}

/**
 * 이미지 가장자리에서 안쪽으로 탐색하며 배경 자동 제거
 */
export function removeBackground(data, width, height, tolerance = 32) {
  // 가장자리 픽셀 중 불투명한 픽셀들을 시작점으로 사용
  const seedColor = findEdgeDominantColor(data, width, height);
  const visited = new Uint8Array(width * height);
  const queue = [];

  // 4면 가장자리 전체를 시드로 등록
  for (let x = 0; x < width; x++) {
    queue.push(x, 0, x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    queue.push(0, y, width - 1, y);
  }

  let head = 0;
  while (head < queue.length) {
    const x = queue[head++];
    const y = queue[head++];

    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    const idx = y * width + x;
    if (visited[idx]) continue;

    const i = idx * 4;
    if (!colorMatch(data[i], data[i + 1], data[i + 2], data[i + 3],
      seedColor[0], seedColor[1], seedColor[2], seedColor[3], tolerance)) continue;

    visited[idx] = 1;
    data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0;

    queue.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
}

function findEdgeDominantColor(data, width, height) {
  const colorCount = {};
  const sample = (x, y) => {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 128) return;
    const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
    colorCount[key] = (colorCount[key] || 0) + 1;
  };

  for (let x = 0; x < width; x++) { sample(x, 0); sample(x, height - 1); }
  for (let y = 0; y < height; y++) { sample(0, y); sample(width - 1, y); }

  let best = null, maxCount = 0;
  for (const [key, count] of Object.entries(colorCount)) {
    if (count > maxCount) { maxCount = count; best = key; }
  }

  if (!best) return [255, 255, 255, 255];
  const parts = best.split(',').map(Number);
  return [parts[0], parts[1], parts[2], 255];
}

function colorMatch(r1, g1, b1, a1, r2, g2, b2, a2, tolerance) {
  if (a2 === 0 && a1 === 0) return true;
  if (a2 === 0 || a1 === 0) return false;
  return (
    Math.abs(r1 - r2) <= tolerance &&
    Math.abs(g1 - g2) <= tolerance &&
    Math.abs(b1 - b2) <= tolerance
  );
}
