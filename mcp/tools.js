// De hulpmiddelen (tools) en kant-en-klare opdrachten (prompts) die Claude krijgt.
// Alles gaat via de http-API van Leerjournaal; deze brug bewaart en ontsleutelt zelf niets.

const BASE = String(process.env.LJ_URL || 'http://localhost:4173').replace(/\/+$/, '');
const TIMEOUT = 30000;
const MAX_TEXT = 120000; // zo blijft een antwoord binnen wat Claude prettig kan lezen

// ---------- verbinding met Leerjournaal ----------
async function api(method, path, body, { raw = false } = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method, signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'x-leerjournaal': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new Error(`Leerjournaal is niet bereikbaar op ${BASE}. Draait de app (of de Mac Mini), en staat Tailscale aan? `
      + 'Het adres stel je in met LJ_URL in de MCP-instellingen van Claude.');
  }
  if (raw && res.ok) return res.text();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 403) throw new Error(`Leerjournaal weigert dit adres (${BASE}). Gebruik http://localhost:… of het https://…ts.net-adres.`);
    throw new Error(data.error || `Leerjournaal gaf fout ${res.status}`);
  }
  return data;
}

const clip = s => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + `\n\n[… ingekort: nog ${s.length - MAX_TEXT} tekens. Gebruik een kortere periode of een filter.]` : s);

// ---------- hulpmiddelen ----------
const tools = [];
const tool = (def, run) => tools.push({ ...def, run });
const schema = (props = {}, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });

tool({
  name: 'leerjournaal_status', title: 'Status van Leerjournaal',
  description: 'Controleert de verbinding met Leerjournaal en geeft de versie en het aantal projecten en chats. Gebruik dit als iets niet lukt.',
  inputSchema: schema()
}, async () => {
  const [st, spaces] = await Promise.all([api('GET', '/api/status'), api('GET', '/api/spaces')]);
  const open = spaces.filter(s => !s.locked);
  return [
    `Verbonden met Leerjournaal op ${BASE}.`,
    `Versie: ${st.version || '?'}${st.commit ? ` (${st.commit})` : ''}`,
    `Projecten: ${open.filter(s => s.type === 'projecten').length} · Chats: ${open.filter(s => s.type === 'chats').length}`
      + (spaces.length > open.length ? ` · ${spaces.length - open.length} vergrendeld (sleutel ontbreekt)` : ''),
    `GitHub-sync: ${st.hasRemote ? 'gekoppeld' : 'niet gekoppeld'}${st.pending ? ` · ${st.pending} wijziging(en) wachten op upload` : ''}`
  ].join('\n');
});

// ---------- kant-en-klare opdrachten ----------
const prompts = [];

// ---------- uitleg voor Claude ----------
const INSTRUCTIONS = readOnly => `Leerjournaal is het persoonlijke leerjournaal van de gebruiker: gedachten per project (school/werk) of chat (persoonlijk), versleuteld opgeslagen.
Belangrijkste regel: documenten bestaan uitsluitend uit de eigen woorden van de gebruiker. Voeg geen feiten, meningen, conclusies of lessen toe die niet in de notities staan.${readOnly ? '\nDeze verbinding staat in alleen-lezen-stand: je kunt niets opslaan.' : ''}`;

module.exports = { tools, prompts, INSTRUCTIONS, api, clip, BASE };
