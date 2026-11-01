#!/usr/bin/env bash
# Zet Leerjournaal in de Claude-app (desktop) als MCP-koppeling, zodat Claude je gedachten kan lezen
# en documenten kan terugzetten, via je eigen Claude-abonnement (geen API-sleutel nodig).
#
# Gebruik (op de computer waar de Claude-app staat, vanuit de app-map van Leerjournaal):
#   bash tools/mcp-installeren.sh                                   # server op deze computer
#   bash tools/mcp-installeren.sh https://mini.tailXXXX.ts.net      # server op je Mac Mini
#   bash tools/mcp-installeren.sh https://… --alleen-lezen          # Claude mag alleen lezen
#
# Je andere koppelingen (zoals canvas-mcp) blijven staan. Van de instellingen wordt eerst een
# reservekopie gemaakt. Opnieuw draaien vervangt alleen de koppeling "leerjournaal".
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
URL=""; READONLY=0
for a in "$@"; do case "$a" in --alleen-lezen) READONLY=1 ;; http://*|https://*) URL="${a%/}" ;; *) echo "Onbekend: $a"; exit 1 ;; esac; done

NODE="$(command -v node || true)"
for n in /opt/homebrew/bin/node /usr/local/bin/node; do [ -z "$NODE" ] && [ -x "$n" ] && NODE="$n"; done
[ -n "$NODE" ] || { echo "Node.js niet gevonden. Installeer het eerst (brew install node)."; exit 1; }
if [ -z "$URL" ]; then
  PORT="$(cd "$APP_DIR" && "$NODE" -e "process.stdout.write(String(require('./lib/config').loadConfig().port||4173))" 2>/dev/null || echo 4173)"
  URL="http://localhost:$PORT"
fi

if [ "$(uname)" = "Darwin" ]; then CONF_DIR="$HOME/Library/Application Support/Claude"
else CONF_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/Claude"; fi
CONF="$CONF_DIR/claude_desktop_config.json"

echo ""
echo "  Leerjournaal koppelen aan Claude"
echo "  Server:  $URL"
if curl -fsS -m 5 -H 'x-leerjournaal: 1' "$URL/api/status" >/dev/null 2>&1; then echo "  Verbinding met Leerjournaal: OK"
else echo "  Let op: Leerjournaal is nu niet bereikbaar op $URL. De koppeling wordt toch gemaakt; zorg dat de server draait (en Tailscale aan staat)."; fi

mkdir -p "$CONF_DIR"
SERVER="$APP_DIR/mcp/server.js"
"$NODE" - "$CONF" "$NODE" "$SERVER" "$URL" "$READONLY" <<'JS'
const fs = require('fs'), path = require('path');
const [conf, node, server, url, readOnly] = process.argv.slice(2);
let cfg = {};
if (fs.existsSync(conf)) {
  const raw = fs.readFileSync(conf, 'utf8');
  try { cfg = raw.trim() ? JSON.parse(raw) : {}; }
  catch (e) { console.error(`  Kan ${conf} niet lezen (${e.message}). Er is niets veranderd.`); process.exit(1); }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  let backup, n = 0;
  do { backup = path.join(path.dirname(conf), `claude_desktop_config.reservekopie-${stamp}${n ? '-' + n : ''}.json`); n++; } while (fs.existsSync(backup));
  fs.writeFileSync(backup, raw, { flag: 'wx' });
  console.log(`  Reservekopie: ${backup}`);
}
cfg.mcpServers = cfg.mcpServers || {};
const others = Object.keys(cfg.mcpServers).filter(k => k !== 'leerjournaal');
cfg.mcpServers.leerjournaal = { command: node, args: [server], env: { LJ_URL: url, ...(readOnly === '1' ? { LJ_MCP_ALLEEN_LEZEN: '1' } : {}) } };
fs.writeFileSync(conf, JSON.stringify(cfg, null, 2) + '\n');
console.log(`  Claude-app: koppeling "leerjournaal" ${others.length ? `toegevoegd (blijven staan: ${others.join(', ')})` : 'toegevoegd'}`);
JS

echo ""
echo "  Klaar. Sluit de Claude-app helemaal af (Cmd+Q) en open hem opnieuw."
echo "  Daarna: klik in een chat op + → Leerjournaal voor de opdrachten, of vraag gewoon:"
echo "    \"Maak met Leerjournaal het document voor Sprint 2 van mijn project\""
echo ""
if command -v claude >/dev/null 2>&1; then
  echo "  Ook in Claude Code gebruiken? Voer dan eenmalig uit:"
  echo "    claude mcp add leerjournaal -s user -e LJ_URL=$URL$([ $READONLY = 1 ] && echo ' -e LJ_MCP_ALLEEN_LEZEN=1') -- \"$NODE\" \"$SERVER\""
  echo ""
fi
