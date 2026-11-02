#!/bin/bash
# Double-click: adds Leerjournaal to the Claude app, so Claude can create documents without an API key.
cd "$(dirname "$0")" || exit 1
echo "Adres van Leerjournaal (het https://…ts.net-adres van je Mac Mini)."
read -r -p "Laat leeg als Leerjournaal op deze Mac draait: " URL
bash tools/install-mcp.sh ${URL:+"$URL"}
read -r -p "Druk op Enter om te sluiten..."
