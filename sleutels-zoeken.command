#!/bin/bash
# Dubbelklik dit bestand op je Mac om oude Leerjournaal-sleutels te zoeken en toe te voegen.
cd "$(dirname "$0")" || exit 1
node tools/zoek-sleutels.js "$@"
read -r -p "Druk op Enter om te sluiten..."
