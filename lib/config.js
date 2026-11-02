// Loads the settings from config.json (git-ignored) and fills in defaults.
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');

const DEFAULTS = {
  port: 4173,
  dataDir: './data',            // folder with the (encrypted) thoughts; becomes its own git repo
  keyFile: './secret.key',      // the secret key; NEVER commit it
  extraKeyFiles: [],            // old keys to read older files (also: every .key file next to keyFile)
  anthropicApiKey: '',          // optional; without a key "Copy prompt" still works
  model: 'claude-sonnet-5-5',
  allowedHosts: [],             // extra host names the app may be reached on (*.ts.net is always allowed)
  tailscaleUsers: [],           // empty = everyone in the Tailscale network; otherwise only these accounts
  githubClientId: '',           // optional: client ID of an own GitHub OAuth app (device flow) for "Sign in with GitHub"
  autoSync: true,               // push to GitHub automatically after every change
  autoSyncMinutes: 10,          // additionally pull and push every 10 minutes (0 = off)
  docDates: 'dag'               // dates in documents: 'geen' (none), 'dag' (day only) or 'dag-tijd' (day and time); stored values stay Dutch
};

function expand(p) {
  if (!p) return p;
  if (p.startsWith('~')) p = path.join(os.homedir(), p.slice(1));
  return path.resolve(APP_DIR, p);
}

function loadConfig() {
  const file = path.join(APP_DIR, 'config.json');
  let user = {};
  if (fs.existsSync(file)) {
    try {
      user = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error(`config.json kon niet gelezen worden: ${e.message}`);
    }
  }
  // instellingen.json: what the user changes under Settings in the app (also git-ignored).
  let ui = {};
  const uiFile = path.join(APP_DIR, 'instellingen.json');
  if (fs.existsSync(uiFile)) { try { ui = JSON.parse(fs.readFileSync(uiFile, 'utf8')); } catch {} }
  const cfg = { ...DEFAULTS, ...user, ...ui };
  cfg.features = { kanban: true, feedback: true, aiButtons: true, ...(user.features || {}), ...(ui.features || {}) };
  cfg.theme = cfg.theme || 'dark';
  cfg.tailscaleUsers = (Array.isArray(cfg.tailscaleUsers) ? cfg.tailscaleUsers : []).map(x => String(x).toLowerCase());
  if (process.env.PORT) cfg.port = Number(process.env.PORT);
  if (process.env.LJ_DATA_DIR) cfg.dataDir = process.env.LJ_DATA_DIR;
  if (process.env.LJ_KEY_FILE) cfg.keyFile = process.env.LJ_KEY_FILE;
  if (process.env.ANTHROPIC_API_KEY) cfg.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  cfg.dataDir = expand(cfg.dataDir);
  cfg.keyFile = expand(cfg.keyFile);
  cfg.extraKeyFiles = (Array.isArray(cfg.extraKeyFiles) ? cfg.extraKeyFiles : []).map(expand);
  cfg.appDir = APP_DIR;
  return cfg;
}

// Saves settings from the app in instellingen.json (only the fields the app may change).
const UI_KEYS = ['theme', 'features', 'autoSync', 'autoSyncMinutes', 'anthropicApiKey', 'model', 'docDates', 'aiProviders', 'aiActive'];
function saveUiSettings(patch) {
  const file = path.join(APP_DIR, 'instellingen.json');
  let cur = {};
  if (fs.existsSync(file)) { try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {} }
  for (const k of UI_KEYS) if (k in patch) cur[k] = patch[k];
  fs.writeFileSync(file, JSON.stringify(cur, null, 2) + '\n', { mode: 0o600 });
  return cur;
}

module.exports = { loadConfig, saveUiSettings, APP_DIR };
