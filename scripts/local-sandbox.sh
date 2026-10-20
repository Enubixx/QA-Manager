#!/usr/bin/env bash
# Local test server: mock Supabase seeded from a read-only prod snapshot + vite pointed at it.
# Never touches production Supabase. The snapshot stays outside the repo (never commit it).
#
#   npm run sandbox:local            # start (or restart) mock + vite in the background
#   npm run sandbox:local -- reset   # re-seed the running mock from the snapshot (drops local edits)
#   npm run sandbox:local -- stop    # stop both servers
#   npm run sandbox:local -- status  # show URLs / whether they're up
#
# Env overrides: SNAPSHOT=/tmp/qa-local/prod-snapshot.json MOCK_PORT=54400 APP_PORT=5190 LOG_DIR=/tmp/qa-local
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SNAPSHOT="${SNAPSHOT:-/tmp/qa-local/prod-snapshot.json}"
MOCK_PORT="${MOCK_PORT:-54400}"
APP_PORT="${APP_PORT:-5190}"
LOG_DIR="${LOG_DIR:-/tmp/qa-local}"
MOCK_URL="http://127.0.0.1:${MOCK_PORT}"
APP_URL="http://127.0.0.1:${APP_PORT}/"
mkdir -p "$LOG_DIR"
MOCK_PID="$LOG_DIR/sandbox-mock.pid"
VITE_PID="$LOG_DIR/sandbox-vite.pid"

up() { curl -s -o /dev/null --max-time 2 "$1"; }

stop_one() {
  local pidfile="$1"
  if [[ -f "$pidfile" ]]; then
    local pid; pid="$(cat "$pidfile")"
    # Kill the whole process group (npx -> node children).
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    rm -f "$pidfile"
  fi
}

status() {
  if up "$MOCK_URL/__admin/stats"; then echo "mock  UP    $MOCK_URL   (seed: $SNAPSHOT)"; else echo "mock  DOWN  $MOCK_URL"; fi
  if up "$APP_URL"; then echo "app   UP    $APP_URL"; else echo "app   DOWN  $APP_URL"; fi
}

case "${1:-start}" in
  stop)
    stop_one "$VITE_PID"; stop_one "$MOCK_PID"; status; exit 0 ;;
  status)
    status; exit 0 ;;
  reset)
    up "$MOCK_URL/__admin/stats" || { echo "mock is not running on $MOCK_URL; run: npm run sandbox:local" >&2; exit 1; }
    # Reload the --seed file the mock was started with (the snapshot).
    curl -s -X POST -H 'content-type: application/json' -d '{}' "$MOCK_URL/__admin/reset" >/dev/null
    echo "mock re-seeded from $SNAPSHOT. Reload the app tabs (or wait for the 4 s poll)."
    exit 0 ;;
  start) ;;
  *) echo "usage: $0 [start|reset|stop|status]" >&2; exit 2 ;;
esac

[[ -f "$SNAPSHOT" ]] || { echo "snapshot not found: $SNAPSHOT" >&2; exit 1; }
case "$SNAPSHOT" in "$ROOT"/*) echo "refusing: keep the snapshot outside the repo ($SNAPSHOT)" >&2; exit 1 ;; esac

stop_one "$VITE_PID"; stop_one "$MOCK_PID"
cd "$ROOT"

setsid npx --no-install tsx tools/rx95-bridge/mock-supabase.ts --port="$MOCK_PORT" --seed="$SNAPSHOT" \
  >"$LOG_DIR/sandbox-mock.log" 2>&1 < /dev/null &
echo $! > "$MOCK_PID"

setsid env VITE_SUPABASE_URL="$MOCK_URL" VITE_SUPABASE_ANON_KEY=mockkey \
  VITE_GEMINI_API_KEY= VITE_GOOGLE_SCRIPT_URL= VITE_RX95_BRIDGE_URL= VITE_PROTOTYPE_SEED_URL= \
  npx --no-install vite --host 127.0.0.1 --port "$APP_PORT" --strictPort \
  >"$LOG_DIR/sandbox-vite.log" 2>&1 < /dev/null &
echo $! > "$VITE_PID"

for _ in $(seq 1 120); do
  up "$MOCK_URL/__admin/stats" && up "$APP_URL" && break
  sleep 0.5
done
status
echo "Logs: $LOG_DIR/sandbox-mock.log, $LOG_DIR/sandbox-vite.log"
echo "Reset data: npm run sandbox:local -- reset    Stop: npm run sandbox:local -- stop"
