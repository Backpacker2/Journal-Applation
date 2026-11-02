// Test scenarios per MCP tool. Uses the first project and the first chat that exist.
// Check labels are Dutch because they are shown to the user when running `npm run mcp-test`.
const readOnlyEnv = () => /^(1|ja|true|yes)$/i.test(process.env.LJ_MCP_READ_ONLY || process.env.LJ_MCP_ALLEEN_LEZEN || '');

module.exports = async ({ rpc, modern, check, text, write }) => {
  const call = async (name, args) => { const r = await rpc('tools/call', modern({ name, arguments: args })); return { r, t: text(r), err: !!r.result?.isError || !!r.error }; };

  // ---------- reading ----------
  const list = await call('list_spaces', {});
  check('list_spaces', !list.err && /# Projecten/.test(list.t), list.t.split('\n')[1]);
  const project = (list.t.split('# Chats')[0].match(/^- (.+?) — /m) || [])[1];
  const chat = (list.t.split('# Chats')[1]?.match(/^- (.+?) — /m) || [])[1];
  if (!project) return check('een project om mee te testen', false);
  const all = await call('read_thoughts', { space: project });
  check('read_thoughts (project)', !all.err && /GEDACHTE|VRAAG/.test(all.t), all.t.split('\n')[0]);
  const ranged = await call('read_thoughts', { space: project, from: '2026-10-30', to: '2026-10-30' });
  check('read_thoughts met periode', !ranged.err && !/## 2026-10-31/.test(ranged.t), ranged.t.split('\n')[0]);
  const unknown = await call('read_thoughts', { space: 'does-not-exist-xyz' });
  check('onbekende ruimte geeft uitleg', unknown.err && /niet gevonden/.test(unknown.t));
  if (chat) { const c = await call('read_thoughts', { space: chat }); check('read_thoughts (chat)', !c.err, c.t.split('\n')[0]); }
  const docs = await call('list_documents', { space: project });
  check('list_documents', !docs.err, docs.t.split('\n')[1] || docs.t);
  const docId = (docs.t.match(/id (\S+)/) || [])[1];
  if (docId) {
    const d = await call('read_document', { space: project, id: docId }); check('read_document', !d.err, d.t.split('\n')[0]);
    const h = await call('read_document', { space: project, id: docId, format: 'html' }); check('read_document als html', !h.err && /<(h\d|p)>/.test(h.t), h.t.slice(0, 40));
  }
  const fb = await call('read_feedback', { space: project }); check('read_feedback', !fb.err, fb.t.split('\n')[0]);
  const cards = await call('list_cards', { space: project }); check('list_cards', !cards.err, cards.t.split('\n')[0]);
  const found = await call('search', { query: 'sleutel' }); check('search', !found.err, found.t.split('\n')[0]);

  // ---------- document task ----------
  const task = await call('document_task', { space: project, from: '2026-01-01' });
  check('document_task', !task.err && /Strikte regels/.test(task.t) && /save_document/.test(task.t), `${task.t.length} tekens`);
  const empty = await call('document_task', { space: project, from: '2030-01-01' });
  check('document_task zonder notities geeft uitleg', /geen notities/.test(empty.t));

  // ---------- safety ----------
  const listed = await rpc('tools/list', modern({}));
  const names = listed.result.tools.map(t => t.name);
  check('geen hulpmiddel om te verwijderen', !names.some(n => /delete|remove|verwijder/i.test(n)));
  check('schrijfhulpmiddelen gemarkeerd', listed.result.tools.filter(t => !t.annotations.readOnlyHint).every(t => ['save_document', 'add_questions'].includes(t.name)));

  // ---------- writing ----------
  if (readOnlyEnv()) {
    const r = await call('save_document', { space: project, title: 'x', content: 'x' });
    check('alleen-lezen: opslaan geweigerd', r.err && !names.includes('save_document'));
  } else if (!write) {
    console.log('  (opslaan niet getest: start met --write)');
  } else {
    const s = await call('save_document', { space: project, title: 'MCP-test', content: '# MCP-test\n\nAlleen een test.' });
    check('save_document', !s.err && /Opgeslagen/.test(s.t), s.t.split('.')[0]);
    const id = (s.t.match(/id (\S+?)\)/) || [])[1];
    const v2 = await call('save_document', { space: project, title: 'MCP-test', content: '# MCP-test v2', based_on: id });
    check('nieuwe versie maakt nieuw document', !v2.err && !v2.t.includes(id), v2.t.split('.')[0]);
    const after = await call('list_documents', { space: project });
    check('eerste versie bestaat nog', after.t.includes(id) && /MCP-test.*versie 2\/2/.test(after.t));
    const q = await call('add_questions', { space: project, questions: ['Wat zou je de volgende keer anders doen?'] });
    check('add_questions', !q.err, q.t);
  }

  // ---------- prompts ----------
  const pl = await rpc('prompts/list', modern({}));
  const pnames = (pl.result?.prompts || []).map(p => p.name);
  check('opdrachten in het menu', ['make_document', 'card_document', 'ask_questions', 'submit_to_portflow'].every(n => pnames.includes(n)), pnames.join(', '));
  const g = await rpc('prompts/get', modern({ name: 'make_document', arguments: { space: project, sprint: 'Sprint 2' } }));
  check('prompts/get make_document', /document_task/.test(g.result?.messages?.[0]?.content?.text || ''));
  const missing = await rpc('prompts/get', modern({ name: 'card_document', arguments: { space: project } }));
  check('verplicht argument ontbreekt → fout', !!missing.error);
  const pf = await rpc('prompts/get', modern({ name: 'submit_to_portflow', arguments: { space: project } }));
  check('submit_to_portflow vraagt bevestiging', /uitdrukkelijke "ja"/.test(pf.result?.messages?.[0]?.content?.text || ''));
};
