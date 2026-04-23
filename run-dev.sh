#!/bin/zsh

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Starting Postgres container..."
cd "$ROOT_DIR"
docker compose -f infra/local/docker-compose.yml up -d

echo "Starting API on http://localhost:3001 ..."
cd "$ROOT_DIR/services/api"
npm run start:dev &
API_PID=$!

echo "Starting Web on http://localhost:3000 ..."
cd "$ROOT_DIR/services/web"
npm run dev &
WEB_PID=$!

cleanup() {
	echo ""
	echo "Stopping dev servers..."
	kill $API_PID 2>/dev/null || true
	kill $WEB_PID 2>/dev/null || true
	wait $API_PID 2>/dev/null || true
	wait $WEB_PID 2>/dev/null || true
}

trap cleanup INT TERM EXIT

wait