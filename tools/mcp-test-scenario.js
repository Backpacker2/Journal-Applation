// Scenario's per hulpmiddel. Gebruikt het eerste project en de eerste chat die er zijn.
module.exports = async ({ rpc, modern, check, text, names, write }) => {
  const call = async (name, args) => { const r = await rpc('tools/call', modern({ name, arguments: args })); return { r, t: text(r), err: !!r.result?.isError || !!r.error }; };
  const list = await call('ruimtes_lijst', {});
  check('ruimtes_lijst', !list.err && /# Projecten/.test(list.t), list.t.split('\n')[1]);
  const project = (list.t.split('# Chats')[0].match(/^- (.+?) — /m) || [])[1];
  const chat = (list.t.split('# Chats')[1]?.match(/^- (.+?) — /m) || [])[1];
  if (!project) return check('een project om mee te testen', false);
  const g = await call('gedachten_lezen', { ruimte: project });
  check('gedachten_lezen (project)', !g.err && /GEDACHTE|VRAAG/.test(g.t), g.t.split('\n')[0]);
  const gv = await call('gedachten_lezen', { ruimte: project, van: '2026-10-30', tot: '2026-10-30' });
  check('gedachten_lezen met periode', !gv.err && !/## 2026-10-31/.test(gv.t), gv.t.split('\n')[0]);
  const fout = await call('gedachten_lezen', { ruimte: 'bestaat-niet-xyz' });
  check('onbekende ruimte geeft uitleg', fout.err && /niet gevonden/.test(fout.t));
  if (chat) { const gc = await call('gedachten_lezen', { ruimte: chat }); check('gedachten_lezen (chat)', !gc.err, gc.t.split('\n')[0]); }
  const d = await call('documenten_lijst', { ruimte: project });
  check('documenten_lijst', !d.err, d.t.split('\n')[1] || d.t);
  const id = (d.t.match(/id (\S+)/) || [])[1];
  if (id) { const dl = await call('document_lezen', { ruimte: project, id }); check('document_lezen', !dl.err, dl.t.split('\n')[0]); }
  const fb = await call('feedback_lezen', { ruimte: project }); check('feedback_lezen', !fb.err, fb.t.split('\n')[0]);
  const k = await call('kaarten_lijst', { ruimte: project }); check('kaarten_lijst', !k.err, k.t.split('\n')[0]);
  const z = await call('zoeken', { zoekterm: 'sleutel' }); check('zoeken', !z.err, z.t.split('\n')[0]);
  module.exports.ctx = { call, project, chat, write };
  for (const extra of module.exports.more || []) await extra({ call, project, chat, write, check, rpc, modern, text, names });
};
module.exports.more = [];
module.exports.more.push(async ({ call, project, check }) => {
  const o = await call('documentopdracht', { ruimte: project, van: '2026-01-01' });
  check('documentopdracht', !o.err && /Strikte regels/.test(o.t) && /document_opslaan/.test(o.t), `${o.t.length} tekens`);
  const leeg = await call('documentopdracht', { ruimte: project, van: '2030-01-01' });
  check('documentopdracht zonder notities geeft uitleg', /geen notities/.test(leeg.t));
});
module.exports.more.push(async ({ call, project, check, write, rpc, modern }) => {
  const list = await rpc('tools/list', modern({}));
  const names = list.result.tools.map(t => t.name);
  check('geen hulpmiddel om te verwijderen', !names.some(n => /verwijder|delete|wis/i.test(n)));
  check('schrijfhulpmiddelen gemarkeerd', list.result.tools.filter(t => !t.annotations.readOnlyHint).every(t => ['document_opslaan', 'vragen_toevoegen'].includes(t.name)));
  if (/^(1|ja|true|yes)$/i.test(process.env.LJ_MCP_ALLEEN_LEZEN || '')) {
    const r = await call('document_opslaan', { ruimte: project, titel: 'x', inhoud: 'x' });
    return check('alleen-lezen: opslaan geweigerd', r.err && !names.includes('document_opslaan'));
  }
  if (!write) return console.log('  (opslaan niet getest: start met --schrijven)');
  const s = await call('document_opslaan', { ruimte: project, titel: 'MCP-test', inhoud: '# MCP-test\n\nAlleen een test.' });
  check('document_opslaan', !s.err && /Opgeslagen/.test(s.t), s.t.split('.')[0]);
  const id = (s.t.match(/id (\S+?)\)/) || [])[1];
  const v2 = await call('document_opslaan', { ruimte: project, titel: 'MCP-test', inhoud: '# MCP-test v2', gebaseerd_op: id });
  check('nieuwe versie maakt nieuw document', !v2.err && !v2.t.includes(id), v2.t.split('.')[0]);
  const lijst = await call('documenten_lijst', { ruimte: project });
  check('eerste versie bestaat nog', lijst.t.includes(id) && /MCP-test.*versie 2\/2/.test(lijst.t));
  const q = await call('vragen_toevoegen', { ruimte: project, vragen: ['Wat zou je de volgende keer anders doen?'] });
  check('vragen_toevoegen', !q.err, q.t);
});
module.exports.more.push(async ({ rpc, modern, check, project }) => {
  const l = await rpc('prompts/list', modern({}));
  const names = (l.result?.prompts || []).map(p => p.name);
  check('opdrachten in het menu', ['document_maken', 'kaart_document', 'vragen_stellen'].every(n => names.includes(n)), names.join(', '));
  const g = await rpc('prompts/get', modern({ name: 'document_maken', arguments: { ruimte: project, sprint: 'Sprint 2' } }));
  check('prompts/get document_maken', /documentopdracht/.test(g.result?.messages?.[0]?.content?.text || ''));
  const mis = await rpc('prompts/get', modern({ name: 'kaart_document', arguments: { ruimte: project } }));
  check('verplicht argument ontbreekt → fout', !!mis.error);
});
module.exports.more.push(async ({ call, rpc, modern, check, project }) => {
  const d = await call('documenten_lijst', { ruimte: project });
  const id = (d.t.match(/id (\S+)/) || [])[1];
  if (id) { const h = await call('document_lezen', { ruimte: project, id, formaat: 'html' }); check('document_lezen als html', !h.err && /<(h\d|p)>/.test(h.t), h.t.slice(0, 40)); }
  const g = await rpc('prompts/get', modern({ name: 'portflow_inleveren', arguments: { ruimte: project } }));
  check('opdracht portflow_inleveren vraagt bevestiging', /uitdrukkelijke "ja"/.test(g.result?.messages?.[0]?.content?.text || ''));
});
