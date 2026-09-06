#!/usr/bin/env bash
# Build, then restart the preview server on a known port so the capture harness
# is never pointed at a stale bundle.
set -euo pipefail
cd /workspace/app

pnpm build > /tmp/build.log 2>&1 || { tail -30 /tmp/build.log; exit 1; }

TMUX="tmux -f /exec-daemon/tmux.portal.conf"
$TMUX kill-session -t city-preview 2>/dev/null || true
for pid in $(ss -ltnpH 2>/dev/null | grep -E ':(4173|4174|4175)' | grep -oP 'pid=\K[0-9]+' | sort -u); do
  kill -9 "$pid" 2>/dev/null || true
done
sleep 2

$TMUX new-session -d -s city-preview -c /workspace/app -- bash -l
$TMUX send-keys -t city-preview:0.0 'cd /workspace/app && pnpm preview --port 4173' C-m

for _ in $(seq 1 30); do
  if curl -sf -o /dev/null http://localhost:4173/; then
    asset=$(curl -s http://localhost:4173/ | strings | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)
    if [ -n "$asset" ] && curl -sf -o /dev/null "http://localhost:4173/$asset"; then
      echo "preview ready on 4173 ($asset)"
      exit 0
    fi
  fi
  sleep 1
done
echo "preview did not come up" >&2
$TMUX capture-pane -p -t city-preview:0.0 | tail -20 >&2
exit 1
