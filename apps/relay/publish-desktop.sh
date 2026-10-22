#!/bin/sh
# Uploads the desktop DMGs (built by `npm run desktop:dist`) to the relay, which serves them at
# /_mono/download/Mono-arm64.dmg and /_mono/download/Mono-x64.dmg.
set -eu
HOST=${MONO_RELAY_HOST:-pelado-oracle}
RELEASE="$(dirname "$0")/../desktop/release"
ssh "$HOST" "mkdir -p /srv/mono-relay/downloads"
for arch in arm64 x64; do
  test -f "$RELEASE/Mono-$arch.dmg" || { echo "Falta $RELEASE/Mono-$arch.dmg" >&2; exit 1; }
done
rsync -az --progress "$RELEASE/Mono-arm64.dmg" "$RELEASE/Mono-x64.dmg" "$HOST:/srv/mono-relay/downloads/"
echo "✓ DMGs publicados"
