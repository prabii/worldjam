#!/usr/bin/env bash
# Pushes the Gemma 4 GGUF to the phone.
#
# The weights are never bundled in the APK: 3.35 GB exceeds every distribution
# limit, and the Gemma license governs redistribution. The app reads the file
# from device storage instead, the same way AI Edge Gallery does.
#
# Usage: scripts/push-model.sh [path-to.gguf]

set -euo pipefail

ADB="${ANDROID_HOME:-$LOCALAPPDATA/Android/Sdk}/platform-tools/adb.exe"
MODEL="${1:-D:/World_jam/gemma-4-E2B_q4_0-it.gguf}"

# The app searches this path first (MODEL_SEARCH_PATHS in llamaRuntime.ts).
DEST_DIR="/data/local/tmp/llama"
DEST_NAME="$(basename "$MODEL")"

if [ ! -f "$MODEL" ]; then
  echo "Model not found: $MODEL" >&2
  exit 1
fi

if ! "$ADB" get-state >/dev/null 2>&1; then
  echo "No device. Connect over USB, or pair with:" >&2
  echo "  adb pair <ip>:<pairing-port>" >&2
  echo "  adb connect <ip>:<connect-port>" >&2
  exit 1
fi

SIZE_MB=$(( $(stat -c%s "$MODEL" 2>/dev/null || stat -f%z "$MODEL") / 1000000 ))
echo "Model:  $DEST_NAME (${SIZE_MB} MB)"
echo "Target: $DEST_DIR/"

# Fail early rather than half-way through a multi-GB transfer.
AVAIL_KB=$("$ADB" shell df /data | awk 'NR==2 {print $4}' | tr -d '\r')
AVAIL_MB=$(( AVAIL_KB / 1024 ))
echo "Free on /data: ${AVAIL_MB} MB"
if [ "$AVAIL_MB" -lt "$(( SIZE_MB + 500 ))" ]; then
  echo "Not enough free space on the device." >&2
  exit 1
fi

"$ADB" shell mkdir -p "$DEST_DIR"

echo "Pushing — this takes several minutes over Wi-Fi (faster over USB)…"
"$ADB" push "$MODEL" "$DEST_DIR/$DEST_NAME"

# World-readable: the app runs as a different uid than the shell that pushed it.
"$ADB" shell chmod 644 "$DEST_DIR/$DEST_NAME"

echo
echo "On device:"
"$ADB" shell ls -la "$DEST_DIR/"
echo
echo "Done. Relaunch WorldJam; the status line under 'Turn it into music'"
echo "should move from 'No model' to 'Gemma ready'."
