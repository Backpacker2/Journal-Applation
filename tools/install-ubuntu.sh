#!/usr/bin/env bash
# Installeert Leerjournaal als vaste dienst op Ubuntu (bijv. je Mac Mini), zodat hij na een herstart vanzelf draait.
# Gebruik:  bash tools/install-ubuntu.sh        (vanuit de app-map, als je eigen gebruiker, dus niet met sudo)
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node || true)"

echo ""
echo "  Leerjournaal installeren als dienst"
echo "  App-map: $APP_DIR"
echo ""

if [ -z "$NODE" ]; then
  echo "  Node.js ontbreekt. Installeer het eerst, bijvoorbeeld:"
  echo "    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
  exit 1
fi
command -v git >/dev/null || { echo "  git ontbreekt: sudo apt-get install -y git"; exit 1; }
[ -f "$APP_DIR/config.json" ] || { echo "  Maak eerst config.json (cp config.example.json config.json) en zet keyFile goed."; exit 1; }

UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/leerjournaal.service" <<UNIT
[Unit]
Description=Leerjournaal
After=network-online.target

[Service]
WorkingDirectory=$APP_DIR
ExecStart=$NODE $APP_DIR/launcher.js
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
UNIT

# Laat de dienst ook draaien als je niet bent ingelogd (na een herstart).
ME="${USER:-$(id -un)}"
loginctl enable-linger "$ME" 2>/dev/null || sudo loginctl enable-linger "$ME"
systemctl --user daemon-reload
systemctl --user enable --now leerjournaal.service
sleep 2
systemctl --user --no-pager status leerjournaal.service | head -5 || true

echo ""
echo "  Klaar. Leerjournaal draait nu op http://localhost:$(node -e "try{console.log(require('$APP_DIR/config.json').port||4173)}catch{console.log(4173)}")"
echo ""
echo "  Volgende stap: bereikbaar maken voor je telefoon via Tailscale:"
echo "    sudo tailscale serve --bg localhost:4173"
echo "    tailscale serve status          (hier staat je https://…ts.net-adres)"
echo ""
echo "  Handig:"
echo "    systemctl --user restart leerjournaal     opnieuw starten"
echo "    journalctl --user -u leerjournaal -f      meldingen bekijken"
echo ""
