#!/usr/bin/env node
/**
 * Transforms the agi-quest-research workflow output (JSON) into a readable
 * markdown research dossier for "The Quest for AGI".
 * Usage: node scripts/build_dossier.js <input.json> <output.md>
 */
const fs = require('fs');

const inFile = process.argv[2];
const outFile = process.argv[3];
const d = JSON.parse(fs.readFileSync(inFile, 'utf8')).result;

const L = [];
const w = (s = '') => L.push(s);

// ---------- Header ----------
w('# The Quest for AGI — Research Dossier');
w('');
w('> Source material for an interactive time-travel investigation game about the history and future of Artificial General Intelligence. The player begins on **30 November 2022** (the day ChatGPT launched) and travels through the timeline of intelligence — back to Turing, forward to a Dyson-sphere superintelligence.');
w('');
w('**How this was produced:** a multi-agent, web-grounded research pass (11 era researchers → adversarial fact-check → game-spine synthesis → completeness critic → gap-fill). Past = strictly fact-checked; future = grounded-speculative (real physics & real futurist ideas).');
w('');
const eras = d.eras || [];
let conf = 0, corr = 0, disp = 0, unv = 0;
eras.forEach(e => (e.verify?.verdicts || []).forEach(v => {
  if (v.status === 'corrected') corr++; else if (v.status === 'disputed') disp++;
  else if (v.status === 'unverifiable') unv++; else conf++;
}));
w(`**Fact-check tally:** ${conf} confirmed · ${corr} corrected · ${disp} disputed · ${unv} unverifiable.`);
w('');
w('---');
w('');

// ---------- Game spine ----------
const s = d.synth || {};
w('## Part I — Game Design Spine');
w('');
if (s.premise) { w('### Premise'); w(''); w(s.premise); w(''); }
if (s.player_role) { w('### Player role'); w(''); w(s.player_role); w(''); }
if (s.central_quest) { w('### Central quest'); w(''); w(s.central_quest); w(''); }
if (s.tone) { w('### Tone'); w(''); w(s.tone); w(''); }
if (s.time_travel_design) { w('### Time-travel mechanic'); w(''); w(s.time_travel_design); w(''); }
if (s.narrative_throughline) { w('### Narrative throughline'); w(''); w(s.narrative_throughline); w(''); }
if (Array.isArray(s.act_structure) && s.act_structure.length) {
  w('### Act structure');
  w('');
  w('| Act | Era span | Goal | Climax |');
  w('| --- | --- | --- | --- |');
  s.act_structure.forEach(a => w(`| ${a.act || ''} | ${a.era_span || ''} | ${(a.goal || '').replace(/\|/g, '\\|')} | ${(a.climax || '').replace(/\|/g, '\\|')} |`));
  w('');
}
if (Array.isArray(s.dramatis_personae_top) && s.dramatis_personae_top.length) {
  w('### Must-include characters (node = "Name (year)")');
  w('');
  s.dramatis_personae_top.forEach(p => w(`- ${p}`));
  w('');
}
if (Array.isArray(s.must_have_locations) && s.must_have_locations.length) {
  w('### Must-include locations (node = "Place (year)")');
  w('');
  s.must_have_locations.forEach(p => w(`- ${p}`));
  w('');
}
w('---');
w('');

// ---------- Eras ----------
w('## Part II — The Eras (research detail)');
w('');
eras.forEach((e, i) => {
  const f = e.findings || {};
  w(`## ${i + 1}. ${f.era || 'Untitled era'}`);
  w('');
  if (f.summary) { w(f.summary); w(''); }

  if (Array.isArray(f.people) && f.people.length) {
    w('### People');
    w('');
    f.people.forEach(p => {
      w(`#### ${p.name}${p.key_year ? ` — *${p.key_year}*` : ''}`);
      const meta = [];
      if (p.role) meta.push(`**Role:** ${p.role}`);
      if (p.location) meta.push(`**Where:** ${p.location}`);
      if (p.years_active) meta.push(`**Active:** ${p.years_active}`);
      if (meta.length) { w(meta.join('  ')); w(''); }
      if (p.contribution) { w(`- **Contribution:** ${p.contribution}`); }
      if (p.agi_relevance) { w(`- **AGI relevance:** ${p.agi_relevance}`); }
      if (p.dramatic_hook) { w(`- **Dramatic hook:** ${p.dramatic_hook}`); }
      w('');
    });
  }

  if (Array.isArray(f.places) && f.places.length) {
    w('### Places');
    w('');
    f.places.forEach(pl => {
      w(`- **${pl.name}${pl.year ? ` (${pl.year})` : ''}**${pl.city ? ` — ${pl.city}` : ''}`);
      if (pl.significance) w(`  - *Significance:* ${pl.significance}`);
      if (pl.sensory) w(`  - *Atmosphere:* ${pl.sensory}`);
    });
    w('');
  }

  if (Array.isArray(f.events) && f.events.length) {
    w('### Events / milestones');
    w('');
    f.events.forEach(ev => {
      w(`- **${ev.date || '—'} · ${ev.title || ''}**`);
      if (ev.description) w(`  - ${ev.description}`);
      if (ev.significance) w(`  - *Why it matters:* ${ev.significance}`);
    });
    w('');
  }

  if (Array.isArray(f.concepts) && f.concepts.length) {
    w('### Key concepts');
    w('');
    f.concepts.forEach(c => {
      w(`- **${c.name}**${c.year ? ` (${c.year}` : ''}${c.originator ? `${c.year ? ', ' : ' ('}${c.originator})` : (c.year ? ')' : '')}: ${c.explanation || ''}`);
    });
    w('');
  }

  if (Array.isArray(f.clue_ideas) && f.clue_ideas.length) {
    w('### Clue ideas (game hooks)');
    w('');
    f.clue_ideas.forEach(c => w(`- **${c.clue}** → unlocks: ${c.unlocks}`));
    w('');
  }

  // verification: only show corrections/disputes (the interesting ones)
  const flags = (e.verify?.verdicts || []).filter(v => v.status === 'corrected' || v.status === 'disputed');
  if (flags.length) {
    w('### ⚠️ Fact-check corrections & disputes');
    w('');
    flags.forEach(v => w(`- **[${v.status}]** ${v.claim}${v.correction ? ` — ${v.correction}` : ''}`));
    w('');
  }

  if (Array.isArray(f.sources) && f.sources.length) {
    w('<details><summary>Sources</summary>');
    w('');
    f.sources.forEach(src => w(`- ${src}`));
    w('');
    w('</details>');
    w('');
  }
  w('---');
  w('');
});

// ---------- Gap fills ----------
const gaps = d.gapFindings || [];
if (gaps.length) {
  w('## Part III — Completeness gap-fills');
  w('');
  w('Items the completeness critic flagged as missing, then researched and verified:');
  w('');
  gaps.forEach(g => {
    w(`#### ${g.item}${g.year ? ` — *${g.year}*` : ''}`);
    if (g.location) { w(`**Where:** ${g.location}`); w(''); }
    if (g.what) w(`- **What:** ${g.what}`);
    if (g.agi_relevance) w(`- **AGI relevance:** ${g.agi_relevance}`);
    if (g.dramatic_hook) w(`- **Dramatic hook:** ${g.dramatic_hook}`);
    if (Array.isArray(g.sources) && g.sources.length) w(`- *Sources:* ${g.sources.join(' · ')}`);
    w('');
  });
  w('---');
  w('');
}

// ---------- Remaining candidate additions ----------
const missing = d.missing || [];
const filledItems = new Set(gaps.map(g => g.item));
const remaining = missing.filter(m => !filledItems.has(m.item)).filter(m => !gaps.some(g => g.item.startsWith(m.item.slice(0, 20))));
if (remaining.length) {
  w('## Part IV — Further candidate nodes (flagged, not yet detailed)');
  w('');
  w('Additional people/places/concepts the critic surfaced as worth including:');
  w('');
  remaining.forEach(m => w(`- **${m.item}** — ${m.why}`));
  w('');
}

fs.writeFileSync(outFile, L.join('\n'));
console.log(`Wrote ${outFile} (${L.join('\n').length} chars, ${L.length} lines)`);
