// The tools and ready-made prompts that Claude gets from the Leerjournaal MCP server.
// Everything goes through the Leerjournaal HTTP API; this bridge stores and decrypts nothing itself.
// Tool names, arguments and descriptions are English; text shown to the user stays Dutch.

const BASE = String(process.env.LJ_URL || 'http://localhost:4173').replace(/\/+$/, '');
const TIMEOUT = 30000;
const MAX_TEXT = 120000; // keeps a response within what Claude can comfortably read

// ---------- connection to Leerjournaal ----------
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

// ---------- tool registry ----------
const tools = [];
const tool = (def, run) => tools.push({ ...def, run });
const schema = (props = {}, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });

tool({
  name: 'leerjournaal_status', title: 'Status van Leerjournaal',
  description: 'Checks the connection to Leerjournaal and reports the version and the number of projects and chats. Use this when something does not work.',
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

// ---------- resolving names ----------
// Claude may use plain names ("My project", "Sprint 2", "PROJ-22", "Research"); they are resolved
// to internal ids here. Case and accents do not matter.
const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const pickOne = (list, query, label, nameOf) => {
  const f = fold(query);
  const exact = list.filter(x => fold(nameOf(x)) === f);
  const partial = exact.length ? exact : list.filter(x => fold(nameOf(x)).includes(f));
  if (partial.length === 1) return partial[0];
  if (!partial.length) throw new Error(`${label} “${query}” niet gevonden. Kies uit: ${list.map(nameOf).join(', ') || '(geen)'}`);
  throw new Error(`“${query}” past op meerdere: ${partial.map(nameOf).join(', ')}. Wees specifieker.`);
};
async function space(name) {
  if (!name) throw new Error('Geef de naam van het project of de chat (zie list_spaces).');
  const list = (await api('GET', '/api/spaces')).filter(s => !s.locked);
  const s = list.find(x => x.slug === name) || pickOne(list, name, 'Project of chat', x => x.name);
  const full = await api('GET', `/api/spaces/${s.type}/${s.slug}`);
  return { ...s, meta: full.meta, entries: full.entries, base: `/api/spaces/${s.type}/${s.slug}` };
}
const sprintOf = (sp, name) => pickOne(sp.meta.sprints || [], name, 'Sprint', x => x.name);
function threadOf(sp, name) {
  if (['algemeen', 'general'].includes(fold(name))) return { id: '', name: 'Algemeen' };
  return pickOne(sp.meta.threads || [], name, 'Chat binnen het project', x => x.name);
}
async function boardOf(sp) {
  if (sp.type !== 'projecten') throw new Error('Kaarten bestaan alleen bij projecten.');
  return api('GET', `${sp.base}/board`);
}
const cardName = c => `${c.remote?.key ? c.remote.key + ' ' : ''}${c.title}`;
function cardOf(board, query) {
  const f = fold(query).replace(/^@/, '');
  const byKey = board.cards.filter(c => fold(c.remote?.key) === f || (/^\d+$/.test(f) && fold(c.remote?.key).endsWith('-' + f)));
  if (byKey.length === 1) return byKey[0];
  const byId = board.cards.find(c => c.id === query);
  if (byId) return byId;
  return pickOne(board.cards, query.replace(/^@/, ''), 'Kaart', cardName);
}
const isDay = d => /^\d{4}-\d{2}-\d{2}$/.test(d);
// Period: a sprint (by name) or from/to (YYYY-MM-DD). Returns { from, to, label }.
function period(sp, { sprint, from, to }) {
  if (sprint) { const x = sprintOf(sp, sprint); return { from: x.from, to: x.to, label: `${x.name} (${x.from} t/m ${x.to})` }; }
  for (const d of [from, to]) if (d && !isDay(d)) throw new Error(`Datum “${d}” moet de vorm JJJJ-MM-DD hebben.`);
  return { from: from || null, to: to || null, label: from || to ? `${from || 'begin'} t/m ${to || 'nu'}` : 'alles' };
}
const day = id => id.slice(0, 10);
const hhmm = id => `${id.slice(11, 13)}:${id.slice(14, 16)}`;

// ---------- reading ----------
const SPACE = { type: 'string', description: 'Name of the project or chat (as shown by list_spaces).' };
const PERIOD = {
  sprint: { type: 'string', description: 'Name of a sprint (projects only), e.g. "Sprint 2". Takes precedence over from/to.' },
  from: { type: 'string', description: 'Start date YYYY-MM-DD (optional).' },
  to: { type: 'string', description: 'End date YYYY-MM-DD, inclusive (optional).' }
};

tool({
  name: 'list_spaces', title: 'Projecten en chats',
  description: 'Lists all projects and chats in Leerjournaal with the number of entries, last activity, sprints and the chats (threads) inside each project. Start here.',
  inputSchema: schema({ archived: { type: 'boolean', description: 'Also include archived ones (default false).' } })
}, async ({ archived }) => {
  const list = (await api('GET', '/api/spaces')).filter(s => archived || !s.archived);
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
  name: 'read_thoughts', title: 'Gedachten lezen',
  description: 'Reads the thoughts, own questions, AI questions and answers of a project or chat, in order, with date and time. Filter by period or sprint, by a chat (thread) inside the project, or by a card (ticket) on the Kanban board.',
  inputSchema: schema({
    space: SPACE, ...PERIOD,
    chat: { type: 'string', description: 'Only this chat inside the project ("Algemeen" or its name).' },
    card: { type: 'string', description: 'Only what is linked to this card: key (PROJ-22), number (22) or title.' }
  }, ['space'])
}, async args => {
  const sp = await space(args.space);
  const p = period(sp, args);
  const known = new Set((sp.meta.threads || []).map(t => t.id));
  const threadName = Object.fromEntries((sp.meta.threads || []).map(t => [t.id, t.name]));
  let list = sp.entries.filter(e => (!p.from || day(e.id) >= p.from) && (!p.to || day(e.id) <= p.to));
  let filter = '';
  if (args.chat) { const t = threadOf(sp, args.chat); list = list.filter(e => (known.has(e.thread) ? e.thread : '') === t.id); filter += ` · chat: ${t.name}`; }
  let cards = {};
  if (sp.type === 'projecten') { try { cards = Object.fromEntries((await boardOf(sp)).cards.map(c => [c.id, c])); } catch {} }
  if (args.card) {
    const c = cardOf({ cards: Object.values(cards) }, args.card);
    const ids = new Set(list.filter(e => (e.links || []).some(l => l.id === c.id)).map(e => e.id));
    list = list.filter(e => ids.has(e.id) || ids.has(e.replyTo)); filter += ` · kaart: ${cardName(c)}`;
  }
  const lines = [`# ${sp.name} (${sp.type === 'projecten' ? 'project' : 'chat'}) · periode: ${p.label}${filter} · ${list.length} berichten`, ''];
  let last = null;
  for (const e of list) {
    if (day(e.id) !== last) { lines.push(`## ${day(e.id)}`); last = day(e.id); }
    const extra = [
      known.size ? `chat: ${threadName[e.thread] || 'Algemeen'}` : '',
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

const KIND_LABEL = { eind: 'eindversie', upload: 'geüpload', ruw: 'ruwe versie' };

tool({
  name: 'list_documents', title: 'Documenten',
  description: 'Lists the documents of a project or chat (raw versions, final versions, uploaded files) with versions, date and links.',
  inputSchema: schema({ space: SPACE }, ['space'])
}, async args => {
  const sp = await space(args.space);
  const docs = await api('GET', `${sp.base}/documents`);
  if (!docs.length) return `${sp.name} heeft nog geen documenten.`;
  return [`# Documenten van ${sp.name}`, ...docs.map(d => `- id ${d.id} · “${d.title}” · ${KIND_LABEL[d.kind] || d.kind} · versie ${d.version}/${d.versions} · ${(d.createdAt || '').slice(0, 16).replace('T', ' ')}${d.from ? ` · gedachten ${d.from} t/m ${d.to}` : ''}${d.fileName ? ` · bestand ${d.fileName}` : ''}`)].join('\n');
});

tool({
  name: 'read_document', title: 'Document lezen',
  description: 'Reads one document (id from list_documents). Format: markdown (default), text, or html (as Portflow expects for portflow_add_evidence from canvas-mcp).',
  inputSchema: schema({ space: SPACE, id: { type: 'string', description: 'Document id.' }, format: { type: 'string', enum: ['markdown', 'text', 'html'], description: 'markdown (default), text or html.' } }, ['space', 'id'])
}, async ({ space: name, id, format }) => {
  const sp = await space(name);
  const d = await api('GET', `${sp.base}/documents/${encodeURIComponent(id)}`);
  const exportFormat = { text: 'txt', html: 'html' }[format];
  const body = exportFormat ? await api('GET', `${sp.base}/documents/${encodeURIComponent(id)}/export/${exportFormat}`, undefined, { raw: true }) : d.content;
  if (format === 'html') return clip(body || '');
  return clip(`# ${d.title}\n(${KIND_LABEL[d.kind] || d.kind}, ${(d.createdAt || '').slice(0, 16).replace('T', ' ')}${d.note ? ` — ${d.note}` : ''})\n\n${body || '(geen tekst)'}`);
});

tool({
  name: 'read_feedback', title: 'Feedback lezen',
  description: 'Reads the feedback of a project (from teachers or others), with the questions it contained, the user\'s answers and what the user learned from it.',
  inputSchema: schema({ space: SPACE, from: PERIOD.from, to: PERIOD.to }, ['space'])
}, async ({ space: name, from, to }) => {
  const sp = await space(name);
  if (sp.type !== 'projecten') return 'Feedback bestaat alleen bij projecten.';
  const items = (await api('GET', `${sp.base}/feedback`)).filter(f => (!from || f.date >= from) && (!to || f.date <= to));
  if (!items.length) return 'Geen feedback in deze periode.';
  return clip(items.map(f => [
    `## ${f.date} · ${f.title}${f.from ? ` (van ${f.from})` : ''}`,
    f.text || '',
    ...(f.questions || []).map(x => `VRAAG: ${x.q}\nMIJN ANTWOORD: ${x.a || '(nog niet beantwoord)'}`),
    f.learned ? `WAT IK ERVAN LEERDE: ${f.learned}` : ''
  ].filter(Boolean).join('\n')).join('\n\n'));
});

tool({
  name: 'list_cards', title: 'Kanbankaarten',
  description: 'Lists the cards (tickets/user stories) on the Kanban board of a project, per column, with their Jira/Trello key and how many thoughts are linked to them.',
  inputSchema: schema({ space: SPACE, search: { type: 'string', description: 'Only cards containing this word or number (optional).' } }, ['space'])
}, async ({ space: name, search }) => {
  const sp = await space(name);
  const b = await boardOf(sp);
  const f = fold(search || '');
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
  name: 'search', title: 'Zoeken in Leerjournaal',
  description: 'Searches all thoughts, questions, answers and documents of all projects and chats.',
  inputSchema: schema({ query: { type: 'string', description: 'Word or phrase (at least 2 characters).' } }, ['query'])
}, async ({ query }) => {
  const r = await api('GET', `/api/search?q=${encodeURIComponent(query)}`);
  const hits = r.results || [];
  if (!hits.length) return `Niets gevonden voor “${query}”.`;
  return clip([`${hits.length} resultaten voor “${query}”:`, ...hits.map(h => `- ${h.spaceName} · ${h.kind === 'document' ? `document “${h.title}” (id ${h.id})` : `${h.kind} ${day(h.id)} ${hhmm(h.id)}`}: ${h.snippet}`)].join('\n'));
});

// ---------- document task ----------
// Exactly the same task as "Kopieer prompt" in the app: rules + template + notes (+ feedback,
// + for a card the linked documents). Claude then writes the document and saves it.
async function documentTask(args) {
  const sp = await space(args.space);
  const p = period(sp, args);
  const body = { from: p.from || '', to: p.to || '' };
  let title = args.title;
  if (args.chats?.length) {
    if (sp.type !== 'projecten') throw new Error('Chats kiezen kan alleen binnen een project.');
    body.threads = args.chats.map(n => threadOf(sp, n).id);
  }
  let card = null;
  if (args.card) { card = cardOf(await boardOf(sp), args.card); body.card = card.id; }
  if (!title) title = card ? cardName(card) : args.sprint ? sprintOf(sp, args.sprint).name : sp.name;
  body.title = title;
  const r = await api('POST', `${sp.base}/prompt`, body);
  return { sp, p, title, card, count: r.count, prompt: r.prompt };
}
const DOC_ARGS = {
  space: SPACE, ...PERIOD,
  chats: { type: 'array', items: { type: 'string' }, description: 'Only these chats inside the project ("Algemeen" and/or names). Empty = all.' },
  card: { type: 'string', description: 'Document about one card: key (PROJ-22), number or title. Only what is linked to it is included.' },
  title: { type: 'string', description: 'Document title (default: sprint, card or project name).' }
};

tool({
  name: 'document_task', title: 'Opdracht voor een document',
  description: 'Returns the complete task for writing a document, exactly like the "Kopieer prompt" button in Leerjournaal: the rules (only the user\'s own words), the template of the project or chat, and the notes from the chosen period, sprint, chats or card. Follow that task exactly and save the result with save_document.',
  inputSchema: schema(DOC_ARGS, ['space'])
}, async args => {
  const t = await documentTask(args);
  if (!t.count) return `Er zijn geen notities voor ${t.sp.name} in deze selectie (${t.p.label}). Kies een andere periode, sprint of kaart.`;
  return clip(`${t.prompt}

---
Saving: write the document following the task above, then call save_document with
space "${t.sp.name}", title "${t.title}", kind "raw"${t.p.from ? `, from "${t.p.from}"` : ''}${t.p.to ? `, to "${t.p.to}"` : ''}${t.card ? `, card "${cardName(t.card)}"` : ''}.
Then show the document to the user; the user turns it into a final version.`);
});

// ---------- saving (only new things; nothing is deleted or overwritten) ----------
tool({
  name: 'save_document', title: 'Document opslaan in Leerjournaal', write: true,
  description: 'Saves a document in Leerjournaal, as a raw version by default. It always creates a NEW document or a new version; existing documents are never overwritten. Use based_on (id) to create a new version of an existing document. Only save text that consists of the user\'s own words.',
  inputSchema: schema({
    space: SPACE,
    title: { type: 'string', description: 'Document title.' },
    content: { type: 'string', description: 'The document in Markdown.' },
    kind: { type: 'string', enum: ['raw', 'final'], description: 'raw (default) or final. Only choose final when the user explicitly asks for it.' },
    from: PERIOD.from, to: PERIOD.to,
    card: { type: 'string', description: 'Link the document to this card (key, number or title).' },
    based_on: { type: 'string', description: 'Id of the document this is a new version of (optional).' }
  }, ['space', 'title', 'content'])
}, async args => {
  const sp = await space(args.space);
  const content = String(args.content || '').trim();
  if (!content) throw new Error('Het document is leeg.');
  if (content.length > 500000) throw new Error('Dit document is te groot (meer dan 500.000 tekens).');
  for (const d of [args.from, args.to]) if (d && !isDay(d)) throw new Error(`Datum “${d}” moet de vorm JJJJ-MM-DD hebben.`);
  // Stored kinds are part of the data format: 'ruw' (raw) and 'eind' (final).
  const body = { kind: args.kind === 'final' ? 'eind' : 'ruw', title: String(args.title).trim().slice(0, 200), content, from: args.from || null, to: args.to || null, generatedBy: 'Claude (via MCP)' };
  if (args.based_on) {
    const docs = await api('GET', `${sp.base}/documents`);
    if (!docs.some(d => d.id === args.based_on)) throw new Error(`Document ${args.based_on} bestaat niet in ${sp.name}. Zie list_documents.`);
    body.basedOn = args.based_on;
  }
  if (args.card) body.links = [cardOf(await boardOf(sp), args.card).id];
  const d = await api('POST', `${sp.base}/documents`, body);
  return `Opgeslagen in ${sp.name} → Documenten: “${d.title}” (${KIND_LABEL[d.kind]}, id ${d.id}). De gebruiker kan het in Leerjournaal nalezen en er een eindversie van maken.`;
});

tool({
  name: 'add_questions', title: 'Vragen toevoegen', write: true,
  description: 'Adds 1 to 5 open questions to a project or chat as "question from AI". The user answers them in Leerjournaal. Only ask questions; give no answers, opinions or advice. Writing thoughts on behalf of the user is not possible.',
  inputSchema: schema({
    space: SPACE,
    questions: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5, description: 'The questions (open, short).' },
    chat: { type: 'string', description: 'Chat inside the project to put the questions in (default Algemeen).' }
  }, ['space', 'questions'])
}, async args => {
  const sp = await space(args.space);
  const questions = (args.questions || []).map(x => String(x).trim().slice(0, 500)).filter(Boolean).slice(0, 5);
  if (!questions.length) throw new Error('Geef minstens één vraag.');
  const thread = args.chat && sp.type === 'projecten' ? threadOf(sp, args.chat).id : '';
  for (const question of questions) await api('POST', `${sp.base}/entries`, { kind: 'vraag', question, source: 'ai', ...(thread ? { thread } : {}) });
  return `${questions.length} ${questions.length === 1 ? 'vraag' : 'vragen'} toegevoegd aan ${sp.name}. De gebruiker beantwoordt ze in Leerjournaal.`;
});

// ---------- ready-made prompts (in Claude's menu) ----------
// The prompt text is the user's own request to Claude, so it is Dutch.
const prompts = [];
const prompt = (def, build) => prompts.push({ ...def, build });
const quote = v => `“${String(v).trim()}”`;
const saveStep = (readOnly, extra = '') => readOnly
  ? 'Laat het document hieronder zien (opslaan kan niet: Leerjournaal staat in alleen-lezen-stand).'
  : `Sla het op met save_document als ruwe versie (kind "raw")${extra}, en laat het daarna hier zien.`;

prompt({
  name: 'make_document', title: 'Document maken (sprint of periode)',
  description: 'Maakt een document van je gedachten in een project of chat, voor een sprint of periode, en zet het als ruwe versie in Leerjournaal.',
  arguments: [
    { name: 'space', description: 'Naam van het project of de chat', required: true },
    { name: 'sprint', description: 'Naam van de sprint (leeg = de periode hieronder, of de laatste twee weken)' },
    { name: 'period', description: 'Optioneel: JJJJ-MM-DD t/m JJJJ-MM-DD' }
  ]
}, (a, { readOnly }) => {
  const m = String(a.period || '').match(/(\d{4}-\d{2}-\d{2}).*?(\d{4}-\d{2}-\d{2})/);
  const twoWeeks = new Date(Date.now() - 13 * 864e5).toISOString().slice(0, 10);
  const scope = a.sprint ? `sprint ${quote(a.sprint)}` : m ? `de periode ${m[1]} t/m ${m[2]}` : `de laatste twee weken (vanaf ${twoWeeks})`;
  const args = a.sprint ? `sprint ${quote(a.sprint)}` : m ? `from "${m[1]}" en to "${m[2]}"` : `from "${twoWeeks}"`;
  return `Maak een document van mijn Leerjournaal voor ${quote(a.space)}, ${scope}.
1. Roep document_task aan met space ${quote(a.space)} en ${args}.
2. Schrijf het document precies volgens die opdracht: alleen mijn eigen woorden, het template volgen, niets toevoegen.
3. ${saveStep(readOnly, ' (met dezelfde titel en periode)')}
4. Noem kort welke onderdelen van het template geen input hadden, zodat ik weet waar ik nog over kan schrijven.`;
});

prompt({
  name: 'card_document', title: 'Document over een kaart (ticket)',
  description: 'Maakt een document over één kaart van het Kanbanbord: alleen de gekoppelde gedachten, feedback en documenten.',
  arguments: [
    { name: 'space', description: 'Naam van het project', required: true },
    { name: 'card', description: 'Sleutel (bijv. PROJ-22), nummer of titel van de kaart', required: true }
  ]
}, (a, { readOnly }) => `Maak een document over kaart ${quote(a.card)} in mijn Leerjournaal-project ${quote(a.space)}.
1. Roep document_task aan met space ${quote(a.space)} en card ${quote(a.card)}.
2. Schrijf het document precies volgens die opdracht: alleen mijn eigen woorden; de kaart zelf is alleen context.
3. ${saveStep(readOnly, ', gekoppeld aan dezelfde kaart')}`);

prompt({
  name: 'ask_questions', title: 'Vragen over mijn gedachten',
  description: 'Laat Claude je recente gedachten lezen en drie open vragen stellen die je helpen verder te denken. De vragen komen in Leerjournaal; jij beantwoordt ze.',
  arguments: [
    { name: 'space', description: 'Naam van het project of de chat', required: true },
    { name: 'chat', description: 'Optioneel: chat binnen het project' }
  ]
}, (a, { readOnly }) => `Lees mijn gedachten van de laatste twee weken in Leerjournaal ${quote(a.space)}${a.chat ? `, chat ${quote(a.chat)}` : ''} (read_thoughts).
Stel daarna precies drie korte, open vragen die mij helpen mijn eigen redenering, keuzes, twijfels, fouten en wat ik geleerd heb onder woorden te brengen. Geef zelf geen antwoorden, meningen of adviezen, en herhaal geen vragen die er al staan.
${readOnly ? 'Zet de vragen hier neer.' : `Zet ze met add_questions in ${quote(a.space)}${a.chat ? ` (chat ${quote(a.chat)})` : ''} en laat ze hier ook zien.`}`);

prompt({
  name: 'submit_to_portflow', title: 'Document in Portflow zetten',
  description: 'Zet een document uit Leerjournaal als bewijs in Portflow, via canvas-mcp. Claude vraagt eerst om bevestiging.',
  arguments: [
    { name: 'space', description: 'Naam van het project', required: true },
    { name: 'document', description: 'Titel of id van het document (leeg = de nieuwste eindversie)' },
    { name: 'course', description: 'Optioneel: naam van de Canvas-cursus' }
  ]
}, a => `Ik wil een document uit Leerjournaal ${quote(a.space)} als bewijs in Portflow zetten.
1. Zoek het document met list_documents: ${a.document ? quote(a.document) : 'de nieuwste eindversie'}. Is er alleen een ruwe versie, vraag dan eerst of ik die echt wil gebruiken.
2. Haal het op met read_document, format "html".
3. Zoek met canvas-mcp de cursus${a.course ? ` ${quote(a.course)}` : ''} (canvas_list_courses) en de goals (portflow_list_goals). Stel voor bij welke goals het past, met een korte motivatie in mijn eigen woorden uit het document.
4. Laat mij vóór het inleveren zien: cursus, titel, sectie/collectie, goals en motivatie. Wacht op mijn uitdrukkelijke "ja".
5. Pas na mijn ja: portflow_add_evidence met de HTML. Lever géén snapshot in (portflow_submit_snapshot), tenzij ik daar apart om vraag en het opnieuw bevestig.
Heb je geen canvas-mcp, zeg dat dan en geef me de HTML om zelf te plakken.`);

// ---------- instructions for Claude ----------
const INSTRUCTIONS = readOnly => `Leerjournaal is the user's personal learning journal: thoughts per project (school/work) or chat (personal), stored encrypted. The user writes in Dutch; answer in the user's language.
Main rule: documents consist only of the user's own words. Do not add facts, opinions, conclusions or lessons that are not in the notes.
Workflow for a document: document_task → write following that task → save_document (raw version) → show the result.
Portflow: a document can be added as evidence via canvas-mcp as HTML (read_document, format html). Only do that after the user explicitly confirms, and never submit a snapshot on your own.${readOnly ? '\nThis connection is read-only: nothing can be saved.' : ''}`;

module.exports = { tools, prompts, INSTRUCTIONS, api, clip, BASE, space, period, threadOf, boardOf, cardOf, cardName };
