#!/bin/sh
# Zips the desktop app for both architectures (ditto keeps the bundle's symlinks and signature)
# and uploads them to the relay, where `npx @famonfa/mono` downloads them from.
set -eu
HOST=${MONO_RELAY_HOST:-pelado-oracle}
RELEASE="$(cd "$(dirname "$0")/../desktop/release" && pwd)"
for pair in "mac-arm64:arm64" "mac:x64"; do
  dir=${pair%%:*}; arch=${pair##*:}
  test -d "$RELEASE/$dir/Mono.app" || { echo "Falta $RELEASE/$dir/Mono.app (npm run desktop:dist)" >&2; exit 1; }
  rm -f "$RELEASE/Mono-$arch.zip"
  ditto -c -k --keepParent "$RELEASE/$dir/Mono.app" "$RELEASE/Mono-$arch.zip"
done
ssh "$HOST" "mkdir -p /srv/mono-relay/downloads"
rsync -az "$RELEASE/Mono-arm64.zip" "$RELEASE/Mono-x64.zip" "$HOST:/srv/mono-relay/downloads/"
echo "✓ App de escritorio publicada"
