#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: $0 <interval_seconds>"
  echo "Example: $0 30"
}

if [[ ${1:-} == "" ]]; then
  usage
  exit 1
fi

INTERVAL="$1"

if ! [[ "$INTERVAL" =~ ^[0-9]+$ ]]; then
  echo "Error: interval_seconds must be an integer (in seconds)."
  usage
  exit 1
fi

# Resolve repo root (script is in scripts/)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$REPO_ROOT/logs"
LOG_FILE="$LOG_DIR/deposit-spammer.log"

mkdir -p "$LOG_DIR"

# If not already running as the worker, detach and re-exec as worker
if [[ ${RUN_AS_WORKER:-0} -ne 1 ]]; then
  echo "Starting detached deposit spammer every ${INTERVAL}s..."
  nohup env RUN_AS_WORKER=1 "$0" "$INTERVAL" >> "$LOG_FILE" 2>&1 < /dev/null &
  PID=$!
  echo "Spawned PID: $PID"
  echo "Logs: $LOG_FILE"
  exit 0
fi

# Worker loop
cd "$REPO_ROOT"
echo "[\"$(date -I)\"] Worker started with interval=${INTERVAL}s" >> "$LOG_FILE"

while true; do
  START_TS=$(date +%s)
  echo "[\"$(date -I)\"] Executing deposit..." >> "$LOG_FILE"

  # Run the deposit command
  ACROSS_API_HOST=testnet.across.to yarn deposit \
    --from 84532 \
    --to 11155111 \
    --token 0x4200000000000000000000000000000000000006 \
    --amount 0.001 \
    --recipient 0x7d9cf0e3b43a6b0b21efbef9ce729408c550d7e3 \
    --exclusiveRelayer 0xca73a9a0e16639aa21775de6c81dbe79e6cbc0a3 >> "$LOG_FILE" 2>&1 &
  DEPOSIT_PID=$!
  echo "[\"$(date -Is)\"] Spawned deposit PID=${DEPOSIT_PID}" >> "$LOG_FILE"

  END_TS=$(date +%s)
  ELAPSED=$(( END_TS - START_TS ))
  SLEEP_FOR=$(( INTERVAL - ELAPSED ))
  if (( SLEEP_FOR < 0 )); then
    SLEEP_FOR=0
  fi
  echo "[\"$(date -Is)\"] Done. Elapsed=${ELAPSED}s. Sleeping ${SLEEP_FOR}s" >> "$LOG_FILE"
  sleep "$SLEEP_FOR"
done


