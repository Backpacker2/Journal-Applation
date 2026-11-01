#!/bin/bash
# Dubbelklik: zet Leerjournaal in de Claude-app, zodat Claude documenten kan maken zonder API-sleutel.
cd "$(dirname "$0")" || exit 1
echo "Adres van Leerjournaal (het https://…ts.net-adres van je Mac Mini)."
read -r -p "Laat leeg als Leerjournaal op deze Mac draait: " URL
bash tools/mcp-installeren.sh ${URL:+"$URL"}
read -r -p "Druk op Enter om te sluiten..."
