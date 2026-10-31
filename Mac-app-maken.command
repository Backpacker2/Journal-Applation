#!/bin/bash
# Dubbelklik: maakt Leerjournaal.app in je map Apps, zodat je Leerjournaal als gewone app opent.
cd "$(dirname "$0")" || exit 1
bash tools/maak-mac-app.sh "$@"
read -r -p "Druk op Enter om te sluiten..."
