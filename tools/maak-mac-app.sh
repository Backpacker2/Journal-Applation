#!/usr/bin/env bash
# Maakt "Leerjournaal.app" in je map Apps (Programma's) op je Mac.
# Klik je erop, dan start de app vanzelf de server (als die nog niet draait) en opent Leerjournaal in een eigen venster.
#
# Gebruik (in Terminal, vanuit de app-map):
#   bash tools/maak-mac-app.sh                          # server op deze Mac
#   bash tools/maak-mac-app.sh https://mini.tailXXXX.ts.net   # alleen openen: de server draait op je Mac Mini
#
# Opnieuw draaien mag altijd: de app wordt dan bijgewerkt. Je gedachten en instellingen worden niet aangeraakt.
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_URL="${1:-}"
[ "$(uname)" = "Darwin" ] || { echo "Dit script is voor macOS."; exit 1; }

NODE="$(command -v node || true)"
for n in /opt/homebrew/bin/node /usr/local/bin/node; do [ -z "$NODE" ] && [ -x "$n" ] && NODE="$n"; done
if [ -z "$REMOTE_URL" ] && [ -z "$NODE" ]; then echo "Node.js niet gevonden. Installeer het eerst (brew install node)."; exit 1; fi
PORT="$(cd "$APP_DIR" && "${NODE:-node}" -e "process.stdout.write(String(require('./lib/config').loadConfig().port||4173))" 2>/dev/null || echo 4173)"

DEST="$HOME/Applications"; mkdir -p "$DEST"
APP="$DEST/Leerjournaal.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Leerjournaal</string>
  <key>CFBundleDisplayName</key><string>Leerjournaal</string>
  <key>CFBundleIdentifier</key><string>app.leerjournaal.mac</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>leerjournaal</string>
  <key>CFBundleIconFile</key><string>Leerjournaal</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
</dict></plist>
PLIST

# Het programma in de app: server starten als dat nodig is, en dan het venster openen.
cat > "$APP/Contents/MacOS/leerjournaal" <<SCRIPT
#!/bin/bash
APP_DIR="$APP_DIR"
NODE="$NODE"
PORT="$PORT"
REMOTE_URL="$REMOTE_URL"
LOG="\$HOME/Library/Logs/Leerjournaal.log"
mkdir -p "\$HOME/Library/Logs"
URL="\${REMOTE_URL:-http://localhost:\$PORT}"
up() { curl -fsS -m 2 -H 'x-leerjournaal: 1' "http://127.0.0.1:\$PORT/api/status" >/dev/null 2>&1; }

if [ -z "\$REMOTE_URL" ] && ! up; then
  if [ ! -d "\$APP_DIR" ]; then osascript -e 'display alert "Leerjournaal" message "De app-map is verplaatst. Draai tools/maak-mac-app.sh opnieuw vanuit de nieuwe map."'; exit 1; fi
  cd "\$APP_DIR" && nohup "\$NODE" launcher.js >> "\$LOG" 2>&1 &
  for i in \$(seq 1 40); do up && break; sleep 0.25; done
  if ! up; then osascript -e "display alert \"Leerjournaal start niet\" message \"Kijk in \$LOG wat er misging.\""; exit 1; fi
fi

# Eigen venster zonder tabbladen als Chrome, Edge of Brave er is; anders gewoon in je standaardbrowser.
for b in "Google Chrome" "Microsoft Edge" "Brave Browser"; do
  if [ -d "/Applications/\$b.app" ] || [ -d "\$HOME/Applications/\$b.app" ]; then
    open -na "\$b" --args --app="\$URL" --user-data-dir="\$HOME/Library/Application Support/Leerjournaal/venster"; exit 0
  fi
done
open "\$URL"
SCRIPT
chmod +x "$APP/Contents/MacOS/leerjournaal"

# Icoon van de app (uit public/icons).
ICON_SRC="$APP_DIR/public/icons/icon-512.png"
if [ -f "$ICON_SRC" ] && command -v iconutil >/dev/null; then
  SET="$(mktemp -d)/Leerjournaal.iconset"; mkdir -p "$SET"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$ICON_SRC" --out "$SET/icon_${s}x${s}.png" >/dev/null
    d=$((s * 2)); [ $d -le 512 ] && sips -z $d $d "$ICON_SRC" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$SET" -o "$APP/Contents/Resources/Leerjournaal.icns" && rm -rf "$(dirname "$SET")"
fi
touch "$APP"   # Finder ververst het icoon

echo ""
echo "  Klaar: $APP"
if [ -n "$REMOTE_URL" ]; then echo "  De app opent $REMOTE_URL (de server draait daar)."
else echo "  De app start de server op deze Mac (poort $PORT) en opent hem. Meldingen: ~/Library/Logs/Leerjournaal.log"; fi
echo "  Tip: sleep Leerjournaal uit Apps naar je Dock."
[ -n "$REMOTE_URL" ] || echo "  De server blijft op de achtergrond draaien tot je je Mac herstart. Stoppen: lsof -ti tcp:$PORT | xargs kill"
echo ""
