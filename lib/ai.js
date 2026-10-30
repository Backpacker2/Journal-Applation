// AI-functies. De AI mag alleen vragen stellen of jouw eigen woorden ordenen, nooit iets toevoegen.

const QUESTION_SYSTEM = `Je helpt iemand nadenken over zijn eigen werk of leven door vragen te stellen.
Regels:
- Je geeft geen antwoorden, meningen, adviezen, uitleg of samenvattingen.
- Stel precies 3 korte, open vragen in het Nederlands.
- De vragen helpen de persoon zijn eigen redenering, keuzes, twijfels, fouten en wat hij geleerd heeft onder woorden te brengen.
- Baseer je alleen op de notities. Herhaal geen vragen die al gesteld zijn.
- Antwoord uitsluitend met een JSON-array van 3 strings, zonder andere tekst.`;

const DOCUMENT_SYSTEM = `Je zet de eigen notities van een gebruiker om in een document. Strikte regels:
1. Gebruik uitsluitend inhoud die de gebruiker zelf heeft geschreven: gedachten, eigen vragen en eigen antwoorden. Een vraag die door een AI is gesteld mag je alleen gebruiken als context bij het antwoord van de gebruiker.
2. Voeg niets toe: geen feiten, meningen, interpretaties, conclusies, adviezen of lessen die niet duidelijk in de notities staan. Denk niet mee en vul geen gaten op.
3. Je mag ordenen, groeperen, dubbelingen samenvoegen, spelling en zinsbouw verbeteren en zinnen licht herformuleren voor leesbaarheid. Blijf zo dicht mogelijk bij de woorden van de gebruiker en schrijf in de ik-vorm.
4. Volg de structuur en instructies van het template. Is er voor een onderdeel geen materiaal, schrijf dan alleen: "_Geen input in deze periode._"
5. Vraagt het template een andere taal, vertaal dan getrouw zonder iets toe te voegen.
6. Noem waar het helpt de datum van een gedachte, zodat zichtbaar blijft hoe het denken zich ontwikkelde.
7. Geef alleen het document in Markdown, zonder inleiding of afsluiting van jezelf.`;

function fmtTime(id) {
  // id: 2026-10-30_13-02-15 -> 2026-10-30 13:02
  return `${id.slice(0, 10)} ${id.slice(11, 13)}:${id.slice(14, 16)}`;
}

function inRange(entry, from, to) {
  const day = entry.id.slice(0, 10);
  return (!from || day >= from) && (!to || day <= to);
}

function formatEntries(entries) {
  const lines = [];
  for (const e of entries) {
    if (e.kind === 'gedachte') {
      const reply = e.replyTo ? ` (reactie op gedachte van ${fmtTime(e.replyTo)})` : '';
      lines.push(`[${fmtTime(e.id)}] GEDACHTE${reply}:\n${e.text}`);
    } else if (e.kind === 'vraag') {
      if (e.source === 'ai' && !e.answer) continue; // onbeantwoorde AI-vraag bevat geen eigen woorden
      const who = e.source === 'ai' ? 'gesteld door AI' : 'eigen vraag';
      lines.push(`[${fmtTime(e.id)}] VRAAG (${who}): ${e.question}\nMIJN ANTWOORD: ${e.answer || '(nog niet beantwoord)'}`);
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

function buildDocumentPrompt(meta, entries, { from, to, title }) {
  const selected = entries.filter(e => inRange(e, from, to));
  const template = (meta.template || '').replaceAll('{titel}', title || meta.name);
  const period = from || to ? `${from || 'begin'} t/m ${to || 'nu'}` : 'alles';
  const user = `# Template\n\n${template}\n\n# Mijn notities (${meta.name}, periode: ${period})\n\n${formatEntries(selected) || '(geen notities in deze periode)'}`;
  return { system: DOCUMENT_SYSTEM, user, count: selected.length };
}

async function callClaude(cfg, { system, user }, maxTokens) {
  if (!cfg.anthropicApiKey) {
    throw Object.assign(new Error('Geen Anthropic API-sleutel ingesteld. Zet "anthropicApiKey" in config.json, of gebruik "Kopieer prompt".'), { status: 400, code: 'NO_KEY' });
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': cfg.anthropicApiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`AI-fout: ${json.error?.message || res.status}`), { status: 502 });
  return (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
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

module.exports = { buildQuestionPrompt, buildDocumentPrompt, callClaude, parseQuestions };
