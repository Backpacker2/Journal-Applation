#!/usr/bin/env bash
# Sets up Leerjournaal on the Mac Mini (Ubuntu) in one go, run from the Mac. See README chapter 13.
#
# Usage (in Terminal on the Mac, from the app folder):
#   bash tools/install-mini.sh user@address-of-the-mini
#
# What it does, and what it never does:
#   - installs git and Node.js on the Mini (asks for the sudo password there once);
#   - clones the app and the data repository to ~/Leerjournaal on the Mini;
#   - copies the key(s) to ~/.leerjournaal/ and the GitHub login (github.json);
#   - creates config.json and installs the app as a service;
#   - optional: installs Tailscale and enables "tailscale serve".
#   Existing files on the Mini are never overwritten or deleted: whatever exists is skipped.
#   Messages to the user are Dutch.
set -euo pipefail

HOST="${1:-}"
if [ -z "$HOST" ]; then
  echo "Gebruik: bash tools/install-mini.sh gebruiker@adres-van-de-mini"
  echo "Bijvoorbeeld: bash tools/install-mini.sh gebruiker@192.168.1.20"
  exit 1
fi
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
stap() { echo ""; echo "==> $*"; }

# Reuse one ssh connection so the password is only typed once.
SOCK="$HOME/.ssh/lj-mini-%r@%h:%p"
mkdir -p "$HOME/.ssh"
SSH=(ssh -o ControlMaster=auto -o "ControlPath=$SOCK" -o ControlPersist=15m)
SCP=(scp -o ControlMaster=auto -o "ControlPath=$SOCK" -o ControlPersist=15m)

stap "Verbinden met $HOST"
"${SSH[@]}" "$HOST" 'echo "  verbonden met $(hostname) ($(. /etc/os-release && echo "$PRETTY_NAME"))"'

stap "Gegevens op deze Mac verzamelen"
[ -f config.json ] || { echo "  Geen config.json in $APP_DIR. Start de app eerst één keer op deze Mac."; exit 1; }
DATA_DIR="$(node -e "process.stdout.write(require('./lib/config').loadConfig().dataDir)")"
DATA_URL="$(git -C "$DATA_DIR" remote get-url origin 2>/dev/null || true)"
[ -n "$DATA_URL" ] || { echo "  Je data-map heeft geen GitHub-remote. Zie README hoofdstuk 6."; exit 1; }
MAIN_KEY="$(node -e "process.stdout.write(require('./lib/config').loadConfig().keyFile)")"
KEYS=()
while IFS= read -r f; do [ -n "$f" ] && KEYS+=("$f"); done < <(node -e "
const fs=require('fs'),path=require('path');const c=require('./lib/config').loadConfig();
const dir=path.dirname(c.keyFile);const out=new Set([c.keyFile]);
if(fs.existsSync(dir))for(const f of fs.readdirSync(dir))if(/\.key$/.test(f))out.add(path.join(dir,f));
for(const f of c.extraKeyFiles||[])out.add(f);
for(const f of out)if(fs.existsSync(f))console.log(f);")
[ "${#KEYS[@]}" -gt 0 ] || { echo "  Geen sleutel gevonden op $MAIN_KEY."; exit 1; }
[ -f github.json ] || { echo "  Nog niet ingelogd bij GitHub in de app. Open de app → Instellingen → GitHub → Beheren, log in, en start dit script opnieuw."; exit 1; }
PORT="$(node -e "process.stdout.write(String(require('./lib/config').loadConfig().port||4173))")"
echo "  data-repository: $DATA_URL"
echo "  sleutels:        ${#KEYS[@]} (hoofdsleutel: $(basename "$MAIN_KEY"))"

stap "git en Node.js op de Mini (vraagt mogelijk je sudo-wachtwoord)"
"${SSH[@]}" -t "$HOST" 'set -e
command -v git >/dev/null || sudo apt-get install -y git
if ! command -v node >/dev/null || [ "$(node -p "process.versions.node.split(\".\")[0]")" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
fi
echo "  git $(git --version | cut -d" " -f3), node $(node --version)"'

stap "App clonen naar ~/Leerjournaal"
"${SSH[@]}" "$HOST" 'set -e
if [ -d ~/Leerjournaal/.git ]; then echo "  bestaat al, bijwerken"; git -C ~/Leerjournaal pull --ff-only -q
else git clone -q https://github.com/Backpacker2/Journal-Applation.git ~/Leerjournaal && echo "  gecloned"; fi'

stap "Sleutels en GitHub-inlog kopiëren"
"${SSH[@]}" "$HOST" 'mkdir -p ~/.leerjournaal && chmod 700 ~/.leerjournaal'
for k in "${KEYS[@]}"; do
  name="$(basename "$k")"
  if "${SSH[@]}" "$HOST" "test -e ~/.leerjournaal/'$name'"; then echo "  $name staat er al, overgeslagen"
  else "${SCP[@]}" -q "$k" "$HOST:.leerjournaal/$name" && echo "  $name gekopieerd"; fi
done
"${SSH[@]}" "$HOST" 'chmod 600 ~/.leerjournaal/*.key'
if "${SSH[@]}" "$HOST" 'test -e ~/Leerjournaal/github.json'; then echo "  github.json staat er al, overgeslagen"
else "${SCP[@]}" -q github.json "$HOST:Leerjournaal/github.json" && "${SSH[@]}" "$HOST" 'chmod 600 ~/Leerjournaal/github.json' && echo "  github.json gekopieerd"; fi

stap "Je gedachten (data-repository) clonen"
"${SSH[@]}" "$HOST" "DATA_URL='$DATA_URL' bash -s" <<'REMOTE'
set -e
cd ~/Leerjournaal
if [ -d data/.git ]; then echo "  data bestaat al, overgeslagen"; exit 0; fi
TOKEN="$(node -p "require('./github.json').token")"
AUTH="$(printf 'x-access-token:%s' "$TOKEN" | base64 -w0)"
GIT_TERMINAL_PROMPT=0 git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $AUTH" clone -q "$DATA_URL" data
echo "  gecloned ($(find data -name '*.txt' -not -path '*/.git/*' | wc -l) bestanden)"
REMOTE

stap "config.json op de Mini"
"${SSH[@]}" "$HOST" "set -e; cd ~/Leerjournaal
if [ -e config.json ]; then echo '  config.json staat er al, overgeslagen'
else printf '{\n  \"port\": $PORT,\n  \"dataDir\": \"./data\",\n  \"keyFile\": \"~/.leerjournaal/$(basename "$MAIN_KEY")\"\n}\n' > config.json && echo '  aangemaakt'; fi"

stap "Leerjournaal als vaste dienst installeren"
"${SSH[@]}" -t "$HOST" 'cd ~/Leerjournaal && bash tools/install-ubuntu.sh'

stap "Tailscale"
read -r -p "  Tailscale nu installeren en aanzetten op de Mini? [j/N] " ans
if [[ "$ans" =~ ^[jJyY] ]]; then
  "${SSH[@]}" -t "$HOST" "set -e
command -v tailscale >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
sudo tailscale serve --bg localhost:$PORT
tailscale serve status"
  echo ""
  echo "  Open het https://…ts.net-adres hierboven op je iPhone (Tailscale aan) → Deel → Zet op beginscherm."
else
  echo "  Overgeslagen. Later op de Mini: sudo tailscale up && sudo tailscale serve --bg localhost:$PORT"
fi

"${SSH[@]}" -O exit "$HOST" 2>/dev/null || true
echo ""
echo "Klaar."
