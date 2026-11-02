#!/bin/bash
# Double-click this file on the Mac to find and add old Leerjournaal keys.
cd "$(dirname "$0")" || exit 1
node tools/find-keys.js "$@"
read -r -p "Druk op Enter om te sluiten..."
