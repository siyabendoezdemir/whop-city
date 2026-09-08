#!/usr/bin/env bash
# Tiles a directory of sweep renders into one labelled contact sheet.
#
# The sweep scripts leave one PNG per candidate, named after it. Comparing them
# means seeing them together — flipping between files loses the difference the
# sweep exists to show. Label comes from the filename, so nothing has to be kept
# in step by hand.
#
#   capture/sheet.sh .frames/own 'l3-*' 3 /tmp/sheet.png
set -euo pipefail

DIR="${1:?directory of renders}"
GLOB="${2:-*.png}"
COLS="${3:-3}"
OUT="${4:-/tmp/sheet.png}"
WIDTH="${SHEET_TILE:-620}"

FONT="$(fc-match -f '%{file}' sans)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

n=0
for f in "$DIR"/$GLOB; do
  [ -e "$f" ] || continue
  label="$(basename "$f" .png)"
  ffmpeg -loglevel error -y -i "$f" \
    -vf "scale=${WIDTH}:-2,drawbox=x=0:y=0:w=iw:h=34:color=black@0.72:t=fill,drawtext=fontfile=${FONT}:text='${label}':x=12:y=7:fontsize=21:fontcolor=white" \
    "$WORK/$(printf '%03d' $n).png"
  n=$((n + 1))
done
[ "$n" -gt 0 ] || { echo "no renders matched $DIR/$GLOB" >&2; exit 1; }

ROWS=$(((n + COLS - 1) / COLS))
ffmpeg -loglevel error -y -pattern_type glob -i "$WORK/*.png" \
  -filter_complex "tile=${COLS}x${ROWS}:padding=6:margin=6:color=#111418" -frames:v 1 "$OUT"
echo "$OUT  ($n tiles, ${COLS}x${ROWS})"
