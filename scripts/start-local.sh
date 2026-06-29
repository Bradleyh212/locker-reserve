#!/bin/zsh

set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Starting Postgres and Redis containers..."
cd "$ROOT_DIR"
docker compose -f infra/local/docker-compose.yml up -d

echo "Installing API dependencies..."
cd "$ROOT_DIR/services/api"
npm ci

echo "Applying database migrations..."
npx prisma migrate deploy

echo "Starting API on http://localhost:3001 ..."
API_PORT="${PORT:-3001}"
export CORS_ORIGIN="${CORS_ORIGIN:-http://localhost:3000}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
PORT="$API_PORT" npm run start:dev &
API_PID=$!

echo "Installing Web dependencies..."
cd "$ROOT_DIR/services/web"
npm ci

echo "Starting Web on http://localhost:3000 ..."
export NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL:-http://localhost:3001}"
PORT=3000 npm run dev &
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
