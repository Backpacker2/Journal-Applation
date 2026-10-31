// AI-functies. De AI mag alleen vragen stellen of jouw eigen woorden ordenen, nooit iets toevoegen.

const QUESTION_SYSTEM = `Je helpt iemand nadenken over zijn eigen werk of leven door vragen te stellen.
Regels:
- Je geeft geen antwoorden, meningen, adviezen, uitleg of samenvattingen.
- Stel precies 3 korte, open vragen in het Nederlands.
- De vragen helpen de persoon zijn eigen redenering, keuzes, twijfels, fouten en wat hij geleerd heeft onder woorden te brengen.
- Baseer je alleen op de notities. Herhaal geen vragen die al gesteld zijn.
- Antwoord uitsluitend met een JSON-array van 3 strings, zonder andere tekst.`;

const DOCUMENT_SYSTEM = `Je zet de eigen notities van een gebruiker om in een document. Strikte regels:
1. Gebruik uitsluitend inhoud die de gebruiker zelf heeft geschreven: gedachten, eigen vragen, eigen antwoorden en wat hij zelf over feedback schreef. Een vraag die door een AI is gesteld, en feedback of vragen van een ander (bijvoorbeeld een docent), mag je alleen gebruiken als context bij wat de gebruiker zelf schreef.
2. Voeg niets toe: geen feiten, meningen, interpretaties, conclusies, adviezen of lessen die niet duidelijk in de notities staan. Denk niet mee en vul geen gaten op.
3. Je mag ordenen, groeperen, dubbelingen samenvoegen, spelling en zinsbouw verbeteren en zinnen licht herformuleren voor leesbaarheid. Blijf zo dicht mogelijk bij de woorden van de gebruiker en schrijf in de ik-vorm.
4. Volg de structuur en instructies van het template. Is er voor een onderdeel geen materiaal, schrijf dan alleen: "_Geen input in deze periode._"
5. Vraagt het template een andere taal, vertaal dan getrouw zonder iets toe te voegen.
6. {DATUMREGEL}
7. Geef alleen het document in Markdown, zonder inleiding of afsluiting van jezelf.`;

function fmtTime(id) {
  // id: 2026-10-30_13-02-15 -> 2026-10-30 13:02
  return `${id.slice(0, 10)} ${id.slice(11, 13)}:${id.slice(14, 16)}`;
}

// Hoe datums in een document komen (instelling docDates). De AI krijgt alleen wat hij mag gebruiken:
// zonder tijd in de invoer kan er ook geen tijd in het document belanden.
const DATE_RULES = {
  geen: 'Noem geen datums en geen tijden in het document. De datums in de notities zijn alleen bedoeld om de volgorde te begrijpen.',
  dag: 'Noem waar het helpt de dag van een gedachte (bijvoorbeeld "op 30 oktober"), zodat zichtbaar blijft hoe het denken zich ontwikkelde. Noem nooit tijden.',
  'dag-tijd': 'Noem waar het helpt de datum en tijd van een gedachte, zodat zichtbaar blijft hoe het denken zich ontwikkelde.'
};
const dateMode = m => (DATE_RULES[m] ? m : 'dag');
const stamp = (id, mode) => (mode === 'dag-tijd' ? fmtTime(id) : id.slice(0, 10));

function inRange(entry, from, to) {
  const day = entry.id.slice(0, 10);
  return (!from || day >= from) && (!to || day <= to);
}

function formatEntries(entries, mode = 'dag-tijd', threadNames = null) {
  const lines = [];
  const chat = e => (threadNames ? ` (chat: ${threadNames[e.thread] || 'Algemeen'})` : '');
  for (const e of entries) {
    if (e.kind === 'gedachte') {
      const reply = e.replyTo ? ` (reactie op gedachte van ${stamp(e.replyTo, mode)})` : '';
      const title = e.title ? ` "${e.title}"` : '';
      lines.push(`[${stamp(e.id, mode)}] GEDACHTE${title}${chat(e)}${reply}:\n${e.text}`);
    } else if (e.kind === 'vraag') {
      if (e.source === 'ai' && !e.answer) continue; // onbeantwoorde AI-vraag bevat geen eigen woorden
      const who = e.source === 'ai' ? 'gesteld door AI' : 'eigen vraag';
      lines.push(`[${stamp(e.id, mode)}] VRAAG${chat(e)} (${who}): ${e.question}\nMIJN ANTWOORD: ${e.answer || '(nog niet beantwoord)'}`);
    }
  }
  return lines.join('\n\n');
}

function buildQuestionPrompt(meta, entries) {
  const recent = entries.slice(-40);
  const asked = entries.filter(e => e.kind === 'vraag').map(e => `- ${e.question}`).join('\n') || '(geen)';
  const user = `Onderwerp: ${meta.name}\n\nEerder gestelde vragen:\n${asked}\n\nNotities:\n${formatEntries(recent.filter(e => e.kind === 'gedachte')) || '(nog geen notities)'}`;
  return { system: QUESTION_SYSTEM, user };
}

function formatFeedback(items) {
  return items.map(f => {
    const parts = [`[${f.date}] FEEDBACK${f.from ? ` van ${f.from}` : ''}${f.title ? ` – ${f.title}` : ''} (niet mijn eigen woorden, alleen context):\n${f.text || '(geen tekst)'}`];
    for (const q of f.questions || []) parts.push(`VRAAG IN DE FEEDBACK: ${q.q}\nMIJN ANTWOORD: ${q.a || '(nog niet beantwoord)'}`);
    if (f.learned) parts.push(`WAT IK ERVAN HEB GELEERD: ${f.learned}`);
    return parts.join('\n');
  }).join('\n\n');
}

function buildDocumentPrompt(meta, entries, { from, to, title, threads }, feedback = [], dates = 'dag') {
  const mode = dateMode(dates);
  // Chats binnen een project: alleen de gekozen chats meenemen ('' = Algemeen); niets gekozen = alles.
  const known = new Set((meta.threads || []).map(t => t.id));
  const threadOf = e => (known.has(e.thread) ? e.thread : '');
  const pick = Array.isArray(threads) && threads.length ? new Set(threads.map(String)) : null;
  const selected = entries.filter(e => inRange(e, from, to) && (!pick || pick.has(threadOf(e))));
  const names = (meta.threads || []).length ? Object.fromEntries((meta.threads || []).map(t => [t.id, t.name])) : null;
  const fb = feedback.filter(f => (!from || f.date >= from) && (!to || f.date <= to));
  const template = (meta.template || '').replaceAll('{titel}', title || meta.name);
  const period = from || to ? `${from || 'begin'} t/m ${to || 'nu'}` : 'alles';
  const user = `# Template\n\n${template}\n\n# Mijn notities (${meta.name}, periode: ${period})\n\n${formatEntries(selected, mode, names) || '(geen notities in deze periode)'}`
    + (fb.length ? `\n\n# Feedback in deze periode\n\n${formatFeedback(fb)}` : '');
  return { system: DOCUMENT_SYSTEM.replace('{DATUMREGEL}', DATE_RULES[mode]), user, count: selected.length + fb.length };
}

function parseQuestions(text) {
  const match = text.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const arr = JSON.parse(match[0]);
      if (Array.isArray(arr)) return arr.map(String).map(s => s.trim()).filter(Boolean).slice(0, 5);
    } catch {}
  }
  return text.split('\n').map(s => s.replace(/^[\s\-*\d.)]+/, '').trim()).filter(s => s.endsWith('?')).slice(0, 5);
}

module.exports = { buildQuestionPrompt, buildDocumentPrompt, parseQuestions };
