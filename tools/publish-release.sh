#!/bin/sh
# Maakt (of werkt bij) de GitHub Release voor een bestaande tag.
# Notes: docs/releases/<tag>.md als dat bestaat (handgeschreven), anders automatisch uit de gemergde PR's.
# Gebruik: tools/publish-release.sh vX.Y.Z   (met gh en GH_TOKEN, en GITHUB_REPOSITORY voor de notes)
set -e
TAG="$1"
[ -n "$TAG" ] || { echo "Gebruik: $0 <tag>" >&2; exit 1; }
DIR="$(cd "$(dirname "$0")/.." && pwd)"
NOTES="$(mktemp)"
if [ -f "$DIR/docs/releases/$TAG.md" ]; then
  cp "$DIR/docs/releases/$TAG.md" "$NOTES"
else
  node "$DIR/tools/release-notes.js" "$TAG" > "$NOTES"
fi
# alleen de hoogste versie is "latest"
NEWEST="$(git -C "$DIR" tag -l 'v*' --sort=-v:refname | head -1)"
if [ "$TAG" = "$NEWEST" ]; then LATEST="--latest"; else LATEST="--latest=false"; fi
if gh release view "$TAG" >/dev/null 2>&1; then
  gh release edit "$TAG" --title "$TAG" --notes-file "$NOTES" "$LATEST"
  echo "Release $TAG bijgewerkt"
else
  gh release create "$TAG" --title "$TAG" --notes-file "$NOTES" --verify-tag "$LATEST"
  echo "Release $TAG aangemaakt"
fi
