#!/bin/bash
# Double-click: creates Leerjournaal.app in ~/Applications so Leerjournaal opens like a normal app.
cd "$(dirname "$0")" || exit 1
bash tools/make-mac-app.sh "$@"
read -r -p "Druk op Enter om te sluiten..."
