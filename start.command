#!/bin/bash
# Dubbelklik dit bestand op je Mac om Leerjournaal te starten.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is niet gevonden. Installeer het via https://nodejs.org of 'brew install node'."
  read -r -p "Druk op Enter om te sluiten..."
  exit 1
fi
( sleep 1 && open "http://localhost:${PORT:-4173}" ) &
node launcher.js
