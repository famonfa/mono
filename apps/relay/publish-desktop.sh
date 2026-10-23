#!/bin/sh
# Zips the desktop app for both architectures (ditto keeps the bundle's symlinks and signature),
# uploads them to the relay and records the version there, so `npx @famonfa/mono` installs it and
# installed apps offer the update. Run locally or from CI (MONO_RELAY_HOST=user@ip).
set -eu
HOST=${MONO_RELAY_HOST:-pelado-oracle}
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RELEASE="$ROOT/apps/desktop/release"
VERSION=$(node -p "require('$ROOT/apps/desktop/package.json').version")
for pair in "mac-arm64:arm64" "mac:x64"; do
  dir=${pair%%:*}; arch=${pair##*:}
  test -d "$RELEASE/$dir/Mono.app" || { echo "Missing $RELEASE/$dir/Mono.app (npm run desktop:dist)" >&2; exit 1; }
  rm -f "$RELEASE/Mono-$arch.zip"
  ditto -c -k --keepParent "$RELEASE/$dir/Mono.app" "$RELEASE/Mono-$arch.zip"
done
printf '{ "version": "%s", "publishedAt": "%s" }\n' "$VERSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$RELEASE/latest.json"
ssh "$HOST" "mkdir -p /srv/mono-relay/downloads"
# Zips first, the version last: an app never sees a version whose files aren't there yet.
rsync -az "$RELEASE/Mono-arm64.zip" "$RELEASE/Mono-x64.zip" "$HOST:/srv/mono-relay/downloads/"
rsync -az "$RELEASE/latest.json" "$HOST:/srv/mono-relay/downloads/"
echo "✓ Desktop app $VERSION published"
