#!/bin/bash
set -euo pipefail

# 웹 환경에서만 실행
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PORT=8080
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# 이미 실행 중이면 스킵
if pgrep -f "http.server ${PORT}" > /dev/null 2>&1; then
  echo "HTTP 서버가 이미 포트 ${PORT}에서 실행 중입니다."
  exit 0
fi

# Python HTTP 서버를 백그라운드로 실행
echo "PixelForge 개발 서버를 포트 ${PORT}에서 시작합니다..."
cd "$PROJECT_DIR"
nohup python3 -m http.server ${PORT} --bind 0.0.0.0 > /tmp/pixelforge-server.log 2>&1 &

# 서버가 기동될 때까지 대기 (최대 10초)
for i in $(seq 1 10); do
  if curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}/" 2>/dev/null | grep -q "200"; then
    echo "서버가 http://localhost:${PORT} 에서 실행 중입니다."
    exit 0
  fi
  sleep 1
done

echo "서버 기동 확인 실패 — 로그: $(cat /tmp/pixelforge-server.log)"
exit 1
