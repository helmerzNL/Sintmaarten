#!/bin/sh
# Zorgt dat de datamap (volume) beschrijfbaar is voor de app-gebruiker en start de app daarna
# zonder root-rechten. Een door Docker aangemaakte ./data-map is anders eigendom van root.
set -e
DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIR"
if [ "$(id -u)" = "0" ]; then
  if [ "$(stat -c %u "$DATA_DIR")" != "$(id -u node)" ]; then
    chown -R node:node "$DATA_DIR" || echo "Waarschuwing: kon de eigenaar van $DATA_DIR niet wijzigen; zet die handmatig op uid 1000." >&2
  fi
  exec su-exec node "$@"
fi
exec "$@"
