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

// ---------- namen opzoeken ----------
// Claude mag namen gebruiken ("Leerjournaal app", "Sprint 2", "PROJ-22", "Sensor onderzoek");
// hier worden die omgezet naar de interne codes. Hoofdletters en accenten maken niet uit.
const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const pickOne = (list, q, label, nameOf) => {
  const f = fold(q);
  const exact = list.filter(x => fold(nameOf(x)) === f);
  const part = exact.length ? exact : list.filter(x => fold(nameOf(x)).includes(f));
  if (part.length === 1) return part[0];
  if (!part.length) throw new Error(`${label} “${q}” niet gevonden. Kies uit: ${list.map(nameOf).join(', ') || '(geen)'}`);
  throw new Error(`“${q}” past op meerdere: ${part.map(nameOf).join(', ')}. Wees specifieker.`);
};
async function space(name) {
  if (!name) throw new Error('Geef de naam van het project of de chat (zie ruimtes_lijst).');
  const list = (await api('GET', '/api/spaces')).filter(s => !s.locked);
  const s = list.find(x => x.slug === name) || pickOne(list, name, 'Project of chat', x => x.name);
  const full = await api('GET', `/api/spaces/${s.type}/${s.slug}`);
  return { ...s, meta: full.meta, entries: full.entries, base: `/api/spaces/${s.type}/${s.slug}` };
}
const sprintOf = (sp, name) => pickOne(sp.meta.sprints || [], name, 'Sprint', x => x.name);
function threadOf(sp, name) {
  if (fold(name) === 'algemeen') return { id: '', name: 'Algemeen' };
  return pickOne(sp.meta.threads || [], name, 'Chat binnen het project', x => x.name);
}
async function boardOf(sp) {
  if (sp.type !== 'projecten') throw new Error('Kaarten bestaan alleen bij projecten.');
  return api('GET', `${sp.base}/board`);
}
const cardName = c => `${c.remote?.key ? c.remote.key + ' ' : ''}${c.title}`;
function cardOf(board, q) {
  const f = fold(q).replace(/^@/, '');
  const byKey = board.cards.filter(c => fold(c.remote?.key) === f || (/^\d+$/.test(f) && fold(c.remote?.key).endsWith('-' + f)));
  if (byKey.length === 1) return byKey[0];
  const byId = board.cards.find(c => c.id === q);
  if (byId) return byId;
  return pickOne(board.cards, q.replace(/^@/, ''), 'Kaart', cardName);
}
// Periode: sprint (naam) of van/tot (JJJJ-MM-DD). Geeft { from, to, label }.
function period(sp, { sprint, van, tot }) {
  if (sprint) { const x = sprintOf(sp, sprint); return { from: x.from, to: x.to, label: `${x.name} (${x.from} t/m ${x.to})` }; }
  for (const d of [van, tot]) if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`Datum “${d}” moet de vorm JJJJ-MM-DD hebben.`);
  return { from: van || null, to: tot || null, label: van || tot ? `${van || 'begin'} t/m ${tot || 'nu'}` : 'alles' };
}
const day = id => id.slice(0, 10);
const hhmm = id => `${id.slice(11, 13)}:${id.slice(14, 16)}`;

// ---------- lezen ----------
const RUIMTE = { type: 'string', description: 'Naam van het project of de chat (zoals in ruimtes_lijst).' };
const PERIODE = {
  sprint: { type: 'string', description: 'Naam van een sprint (alleen projecten), bijvoorbeeld "Sprint 2". Gaat voor van/tot.' },
  van: { type: 'string', description: 'Begindatum JJJJ-MM-DD (optioneel).' },
  tot: { type: 'string', description: 'Einddatum JJJJ-MM-DD, tot en met (optioneel).' }
};

tool({
  name: 'ruimtes_lijst', title: 'Projecten en chats',
  description: 'Toont alle projecten en chats in Leerjournaal, met aantal gedachten, laatste activiteit, sprints en de chats binnen een project. Begin hiermee.',
  inputSchema: schema({ archief: { type: 'boolean', description: 'Ook gearchiveerde tonen (standaard nee).' } })
}, async ({ archief }) => {
  const list = (await api('GET', '/api/spaces')).filter(s => archief || !s.archived);
  const out = [];
  for (const type of ['projecten', 'chats']) {
    out.push(type === 'projecten' ? '# Projecten' : '\n# Chats');
    const items = list.filter(s => s.type === type);
    if (!items.length) out.push('(geen)');
    for (const s of items) {
      if (s.locked) { out.push(`- (vergrendeld: sleutel ontbreekt)`); continue; }
      out.push(`- ${s.name} — ${s.count} berichten${s.lastEntry ? `, laatst ${day(s.lastEntry)}` : ''}${s.archived ? ' [archief]' : ''}`);
      if (type === 'projecten') {
        const { meta } = await api('GET', `/api/spaces/${s.type}/${s.slug}`);
        if ((meta.sprints || []).length) out.push(`  Sprints: ${meta.sprints.map(x => `${x.name} (${x.from} t/m ${x.to})`).join('; ')}`);
        if ((meta.threads || []).length) out.push(`  Chats in dit project: Algemeen, ${meta.threads.map(t => t.name).join(', ')}`);
      }
    }
  }
  return out.join('\n');
});

tool({
  name: 'gedachten_lezen', title: 'Gedachten lezen',
  description: 'Leest de gedachten, eigen vragen, AI-vragen en antwoorden van een project of chat, in volgorde, met datum en tijd. Filter op periode of sprint, op een chat binnen het project, of op een kaart (ticket) van het Kanbanbord.',
  inputSchema: schema({
    ruimte: RUIMTE, ...PERIODE,
    chat: { type: 'string', description: 'Alleen deze chat binnen het project ("Algemeen" of de naam).' },
    kaart: { type: 'string', description: 'Alleen wat aan deze kaart gekoppeld is: sleutel (PROJ-22), nummer (22) of titel.' }
  }, ['ruimte'])
}, async args => {
  const sp = await space(args.ruimte);
  const p = period(sp, args);
  const known = new Set((sp.meta.threads || []).map(t => t.id));
  const tname = Object.fromEntries((sp.meta.threads || []).map(t => [t.id, t.name]));
  let list = sp.entries.filter(e => (!p.from || day(e.id) >= p.from) && (!p.to || day(e.id) <= p.to));
  let filter = '';
  if (args.chat) { const t = threadOf(sp, args.chat); list = list.filter(e => (known.has(e.thread) ? e.thread : '') === t.id); filter += ` · chat: ${t.name}`; }
  let cards = {};
  if (sp.type === 'projecten') { try { cards = Object.fromEntries((await boardOf(sp)).cards.map(c => [c.id, c])); } catch {} }
  if (args.kaart) {
    const c = cardOf({ cards: Object.values(cards) }, args.kaart);
    const ids = new Set(list.filter(e => (e.links || []).some(l => l.id === c.id)).map(e => e.id));
    list = list.filter(e => ids.has(e.id) || ids.has(e.replyTo)); filter += ` · kaart: ${cardName(c)}`;
  }
  const lines = [`# ${sp.name} (${sp.type === 'projecten' ? 'project' : 'chat'}) · periode: ${p.label}${filter} · ${list.length} berichten`, ''];
  let last = null;
  for (const e of list) {
    if (day(e.id) !== last) { lines.push(`## ${day(e.id)}`); last = day(e.id); }
    const extra = [
      known.size ? `chat: ${tname[e.thread] || 'Algemeen'}` : '',
      e.replyTo ? `reactie op ${day(e.replyTo)} ${hhmm(e.replyTo)}` : '',
      (e.links || []).map(l => cards[l.id]).filter(Boolean).map(c => `kaart: ${cardName(c)}`).join(', ')
    ].filter(Boolean).join(' · ');
    if (e.kind === 'vraag') lines.push(`[${hhmm(e.id)}] VRAAG (${e.source === 'ai' ? 'van AI' : 'eigen vraag'})${extra ? ` (${extra})` : ''}: ${e.question}\nANTWOORD: ${e.answer || '(nog niet beantwoord)'}`);
    else lines.push(`[${hhmm(e.id)}] GEDACHTE${extra ? ` (${extra})` : ''}:\n${e.text}`);
    lines.push('');
  }
  if (!list.length) lines.push('(geen berichten in deze selectie)');
  return clip(lines.join('\n'));
});

tool({
  name: 'documenten_lijst', title: 'Documenten',
  description: 'Toont de documenten van een project of chat (ruwe versies, eindversies, geüploade bestanden), met versies, datum en koppelingen.',
  inputSchema: schema({ ruimte: RUIMTE }, ['ruimte'])
}, async ({ ruimte }) => {
  const sp = await space(ruimte);
  const docs = await api('GET', `${sp.base}/documents`);
  if (!docs.length) return `${sp.name} heeft nog geen documenten.`;
  const kind = k => ({ eind: 'eindversie', upload: 'geüpload', ruw: 'ruwe versie' }[k] || k);
  return [`# Documenten van ${sp.name}`, ...docs.map(d => `- id ${d.id} · “${d.title}” · ${kind(d.kind)} · versie ${d.version}/${d.versions} · ${(d.createdAt || '').slice(0, 16).replace('T', ' ')}${d.from ? ` · gedachten ${d.from} t/m ${d.to}` : ''}${d.fileName ? ` · bestand ${d.fileName}` : ''}`)].join('\n');
});

tool({
  name: 'document_lezen', title: 'Document lezen',
  description: 'Leest één document (id uit documenten_lijst). Formaat: markdown (standaard) of tekst.',
  inputSchema: schema({ ruimte: RUIMTE, id: { type: 'string', description: 'Id van het document.' }, formaat: { type: 'string', enum: ['markdown', 'tekst'], description: 'markdown (standaard) of tekst.' } }, ['ruimte', 'id'])
}, async ({ ruimte, id, formaat }) => {
  const sp = await space(ruimte);
  const d = await api('GET', `${sp.base}/documents/${encodeURIComponent(id)}`);
  const body = formaat === 'tekst' ? await api('GET', `${sp.base}/documents/${encodeURIComponent(id)}/export/txt`, undefined, { raw: true }) : d.content;
  return clip(`# ${d.title}\n(${d.kind}, ${(d.createdAt || '').slice(0, 16).replace('T', ' ')}${d.note ? ` — ${d.note}` : ''})\n\n${body || '(geen tekst)'}`);
});

tool({
  name: 'feedback_lezen', title: 'Feedback lezen',
  description: 'Leest de feedback van een project (van docenten of anderen), met de vragen die erin stonden, mijn antwoorden en wat ik ervan leerde.',
  inputSchema: schema({ ruimte: RUIMTE, van: PERIODE.van, tot: PERIODE.tot }, ['ruimte'])
}, async ({ ruimte, van, tot }) => {
  const sp = await space(ruimte);
  if (sp.type !== 'projecten') return 'Feedback bestaat alleen bij projecten.';
  const items = (await api('GET', `${sp.base}/feedback`)).filter(f => (!van || f.date >= van) && (!tot || f.date <= tot));
  if (!items.length) return 'Geen feedback in deze periode.';
  return clip(items.map(f => [
    `## ${f.date} · ${f.title}${f.from ? ` (van ${f.from})` : ''}`,
    f.text || '',
    ...(f.questions || []).map(q => `VRAAG: ${q.q}\nMIJN ANTWOORD: ${q.a || '(nog niet beantwoord)'}`),
    f.learned ? `WAT IK ERVAN LEERDE: ${f.learned}` : ''
  ].filter(Boolean).join('\n')).join('\n\n'));
});

tool({
  name: 'kaarten_lijst', title: 'Kanbankaarten',
  description: 'Toont de kaarten (tickets/user stories) van het Kanbanbord van een project, per kolom, met Jira/Trello-sleutel en hoeveel er aan gekoppeld is.',
  inputSchema: schema({ ruimte: RUIMTE, zoek: { type: 'string', description: 'Alleen kaarten met dit woord of nummer (optioneel).' } }, ['ruimte'])
}, async ({ ruimte, zoek }) => {
  const sp = await space(ruimte);
  const b = await boardOf(sp);
  const f = fold(zoek || '');
  const linked = id => sp.entries.filter(e => (e.links || []).some(l => l.id === id)).length;
  const out = [`# Kanban van ${sp.name}${b.link ? ` (gekoppeld met ${b.link.kind === 'jira' ? 'Jira' : 'Trello'}: ${b.link.target.name})` : ''}`];
  for (const col of b.columns) {
    const cards = b.cards.filter(c => c.column === col.id && (!f || fold(`${c.title} ${c.description} ${c.remote?.key || ''}`).includes(f)));
    if (!cards.length && f) continue;
    out.push(`\n## ${col.name} (${cards.length})`);
    for (const c of cards) out.push(`- ${cardName(c)}${linked(c.id) ? ` · ${linked(c.id)} gedachte(n) gekoppeld` : ''}${c.description ? `\n  ${c.description.replace(/\n/g, ' ').slice(0, 200)}` : ''}`);
  }
  return clip(out.join('\n'));
});

tool({
  name: 'zoeken', title: 'Zoeken in Leerjournaal',
  description: 'Zoekt in alle gedachten, vragen, antwoorden en documenten van alle projecten en chats.',
  inputSchema: schema({ zoekterm: { type: 'string', description: 'Woord of zin (minstens 2 tekens).' } }, ['zoekterm'])
}, async ({ zoekterm }) => {
  const r = await api('GET', `/api/search?q=${encodeURIComponent(zoekterm)}`);
  const hits = r.results || [];
  if (!hits.length) return `Niets gevonden voor “${zoekterm}”.`;
  return clip([`${hits.length} resultaten voor “${zoekterm}”:`, ...hits.map(h => `- ${h.spaceName} · ${h.kind === 'document' ? `document “${h.title}” (id ${h.id})` : `${h.kind} ${day(h.id)} ${hhmm(h.id)}`}: ${h.snippet}`)].join('\n'));
});

// ---------- documentopdracht ----------
// Precies dezelfde opdracht als "Kopieer prompt" in de app: regels + template + notities (+ feedback,
// + bij een kaart de gekoppelde documenten). Claude schrijft daarna het document en slaat het op.
async function documentTask(args) {
  const sp = await space(args.ruimte);
  const p = period(sp, args);
  const body = { from: p.from || '', to: p.to || '' };
  let title = args.titel;
  if (args.chats?.length) {
    if (sp.type !== 'projecten') throw new Error('Chats kiezen kan alleen binnen een project.');
    body.threads = args.chats.map(n => threadOf(sp, n).id);
  }
  let card = null;
  if (args.kaart) { card = cardOf(await boardOf(sp), args.kaart); body.card = card.id; }
  if (!title) title = card ? cardName(card) : args.sprint ? sprintOf(sp, args.sprint).name : sp.name;
  body.title = title;
  const r = await api('POST', `${sp.base}/prompt`, body);
  return { sp, p, title, card, count: r.count, prompt: r.prompt };
}
const DOC_ARGS = {
  ruimte: RUIMTE, ...PERIODE,
  chats: { type: 'array', items: { type: 'string' }, description: 'Alleen deze chats binnen het project ("Algemeen" en/of namen). Leeg = alle.' },
  kaart: { type: 'string', description: 'Document over één kaart: sleutel (PROJ-22), nummer of titel. Alleen wat eraan gekoppeld is gaat mee.' },
  titel: { type: 'string', description: 'Titel van het document (standaard: sprint, kaart of projectnaam).' }
};

tool({
  name: 'documentopdracht', title: 'Opdracht voor een document',
  description: 'Geeft de volledige opdracht om een document te schrijven, precies zoals de knop "Kopieer prompt" in Leerjournaal: de regels (alleen de eigen woorden van de gebruiker), het template van het project of de chat, en de notities uit de gekozen periode, sprint, chats of kaart. Volg die opdracht exact en sla het resultaat op met document_opslaan.',
  inputSchema: schema(DOC_ARGS, ['ruimte'])
}, async args => {
  const t = await documentTask(args);
  if (!t.count) return `Er zijn geen notities voor ${t.sp.name} in deze selectie (${t.p.label}). Kies een andere periode, sprint of kaart.`;
  return clip(`${t.prompt}

---
Opslaan: schrijf het document volgens de opdracht hierboven en roep daarna document_opslaan aan met
ruimte "${t.sp.name}", titel "${t.title}", soort "ruw"${t.p.from ? `, van "${t.p.from}"` : ''}${t.p.to ? `, tot "${t.p.to}"` : ''}${t.card ? `, kaart "${cardName(t.card)}"` : ''}.
Laat het document daarna aan de gebruiker zien; hij maakt er zelf een eindversie van.`);
});

// ---------- kant-en-klare opdrachten ----------
const prompts = [];

// ---------- uitleg voor Claude ----------
const INSTRUCTIONS = readOnly => `Leerjournaal is het persoonlijke leerjournaal van de gebruiker: gedachten per project (school/werk) of chat (persoonlijk), versleuteld opgeslagen.
Belangrijkste regel: documenten bestaan uitsluitend uit de eigen woorden van de gebruiker. Voeg geen feiten, meningen, conclusies of lessen toe die niet in de notities staan.${readOnly ? '\nDeze verbinding staat in alleen-lezen-stand: je kunt niets opslaan.' : ''}`;

module.exports = { tools, prompts, INSTRUCTIONS, api, clip, BASE, space, period, threadOf, boardOf, cardOf, cardName };
