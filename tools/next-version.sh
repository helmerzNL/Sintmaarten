#!/bin/sh
# Bepaalt het versienummer van de volgende build: <major.minor uit VERSION>.<patch>.
# De patch is 1 hoger dan de hoogste bestaande tag v<major.minor>.<patch>; zonder tag begint hij bij 0
# (dus de eerste build is v0.1.0). Gebruik: tools/next-version.sh  ->  schrijft bv. "0.1.3".
set -e
BASE="$(tr -d '[:space:]' < "$(dirname "$0")/../VERSION")"
LAST="$(git tag -l "v${BASE}.*" | sed "s/^v${BASE}\.//" | grep -E '^[0-9]+$' | sort -n | tail -1 || true)"
if [ -z "$LAST" ]; then PATCH=0; else PATCH=$((LAST + 1)); fi
echo "${BASE}.${PATCH}"
