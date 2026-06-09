#!/usr/bin/env node
/**
 * Merge the 5 approved new nodes (Musk/xAI, Google Brain, NVIDIA, Bengio/Mila, Meta) into the
 * AGI game data, using the additions-prose workflow output for text. Re-validates integrity + solvability.
 *
 * Usage: node scripts/merge_additions.js <agi_game_data.json> <additions-prose-output.json>
 */
const fs = require('fs');
const [dataPath, prosePath] = process.argv.slice(2);
const g = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const prose = (JSON.parse(fs.readFileSync(prosePath, 'utf8')).result || {}).bundles || [];
const byLoc = {}; prose.forEach(b => { if (b && b.locationId) byLoc[b.locationId] = b; });

// Structural spec — must mirror the workflow's ADDITIONS (ids, types, coords, revealer mapping).
const SPEC = [
  { locId:'xai_2023', name:'xAI, Palo Alto (2023)', act:4, type:'lab', lat:37.4419, lng:-122.1430,
    char:{ id:'elon_musk_2023', name:'Elon Musk (2023)', role:'OpenAI co-founder turned rival; founder of xAI and Grok' },
    reveal:[ {id:'clue_grok_xai', type:'milestone'}, {id:'clue_summoning_the_demon', type:'warning'} ],
    unlock:{ id:'clue_estranged_cofounder', type:'contradiction', revealerId:'sam_altman_2023' } },
  { locId:'google_brain_2017', name:'Google Brain, Mountain View (2017)', act:3, type:'lab', lat:37.4220, lng:-122.0841,
    char:{ id:'noam_shazeer_2017', name:'Noam Shazeer (2017)', role:'Transformer co-author at Google; later co-founded Character.AI' },
    reveal:[ {id:'clue_transformer_birthplace', type:'breakthrough'}, {id:'clue_google_invented_openai_shipped', type:'contradiction'} ],
    unlock:{ id:'clue_google_origin', type:'breakthrough', revealerId:'ashish_vaswani_2017' } },
  { locId:'nvidia_2012', name:'NVIDIA HQ, Santa Clara (2012)', act:3, type:'lab', lat:37.3705, lng:-121.9959,
    char:{ id:'jensen_huang_2012', name:'Jensen Huang (2012)', role:'Co-founder & CEO of NVIDIA; GPUs and CUDA powered deep learning' },
    reveal:[ {id:'clue_cuda_gpu_engine', type:'breakthrough'}, {id:'clue_compute_is_fuel', type:'concept'} ],
    unlock:{ id:'clue_gpu_substrate', type:'breakthrough', revealerId:'alex_krizhevsky_2012' } },
  { locId:'mila_montreal_2018', name:'Mila, Montreal (2018)', act:3, type:'lab', lat:45.5300, lng:-73.6130,
    char:{ id:'yoshua_bengio_2018', name:'Yoshua Bengio (2018)', role:'Deep-learning pioneer; 2018 Turing Award laureate; AI-safety voice' },
    reveal:[ {id:'clue_turing_award_2018', type:'milestone'}, {id:'clue_bengio_safety_turn', type:'warning'} ],
    unlock:{ id:'clue_third_godfather', type:'person', revealerId:'geoffrey_hinton_2006' } },
  { locId:'meta_ai_2023', name:'Meta AI, Menlo Park (2023)', act:4, type:'lab', lat:37.4848, lng:-122.1484,
    char:{ id:'mark_zuckerberg_2023', name:'Mark Zuckerberg (2023)', role:'CEO of Meta; bet on open-weight AI with the LLaMA models' },
    reveal:[ {id:'clue_llama_open_weights', type:'milestone'}, {id:'clue_open_vs_closed', type:'contradiction'} ],
    unlock:{ id:'clue_open_weights_future', type:'prediction', revealerId:'yann_lecun_1989' } },
];

let added = 0; const warn = [];
for (const s of SPEC) {
  const b = byLoc[s.locId];
  if (!b) { warn.push(`no prose bundle for ${s.locId} — skipped`); continue; }
  // location
  g.locations[s.locId] = {
    id: s.locId, name: s.name, description: b.locationDescription || '',
    coords: [s.lat, s.lng], type: s.type, unlocked: false,
    unlockedBy: [s.unlock.id], characters: [s.char.id],
  };
  // new character + its clue map
  const cluesMap = {}; const revById = {};
  (b.character.reveals || []).forEach(r => { revById[r.clueId] = r; });
  for (const rc of s.reveal) {
    const r = revById[rc.id] || {};
    cluesMap[rc.id] = { triggerCondition: r.triggerCondition || '', knowledge: r.knowledge || '' };
    g.clues[rc.id] = { id: rc.id, title: r.title || rc.id, description: r.description || '', type: rc.type,
      unlocksLocation: null, linkedClues: s.reveal.filter(x => x.id !== rc.id).map(x => x.id).concat([s.unlock.id]) };
  }
  g.characters[s.char.id] = {
    id: s.char.id, name: s.char.name, role: s.char.role, location: s.locId,
    portrait_mood: b.character.portrait_mood || '', systemPrompt: b.character.systemPrompt || '',
    anonymousName: b.character.anonymousName || 'Unknown', clues: cluesMap,
  };
  // unlock clue (unlocks the new location)
  g.clues[s.unlock.id] = { id: s.unlock.id, title: b.unlockClue.title || s.unlock.id, description: b.unlockClue.description || '',
    type: s.unlock.type, unlocksLocation: s.locId, linkedClues: s.reveal.map(x => x.id) };
  // attach unlock clue to the EXISTING revealer character
  const rev = g.characters[s.unlock.revealerId];
  if (!rev) { warn.push(`revealer ${s.unlock.revealerId} not found for ${s.locId}`); continue; }
  rev.clues[s.unlock.id] = { triggerCondition: b.unlockClue.revealerTrigger || '', knowledge: b.unlockClue.revealerKnowledge || '' };
  added++;
}

// ---- validate integrity + BFS solvability ----
function validate(g) {
  const e = [];
  const L = new Set(Object.keys(g.locations)), C = new Set(Object.keys(g.clues)), T = new Set(Object.keys(g.clueTypes));
  for (const c of Object.values(g.characters)) {
    if (!L.has(c.location)) e.push(`char ${c.id} -> unknown loc ${c.location}`);
    for (const cid of Object.keys(c.clues||{})) if (!C.has(cid)) e.push(`char ${c.id} clue ${cid} missing`);
  }
  for (const c of Object.values(g.clues)) {
    if (!T.has(c.type)) e.push(`clue ${c.id} bad type ${c.type}`);
    if (c.unlocksLocation && !L.has(c.unlocksLocation)) e.push(`clue ${c.id} -> unknown loc`);
    for (const l of (c.linkedClues||[])) if (!C.has(l)) e.push(`clue ${c.id} link ${l} missing`);
  }
  const revealed = {}; for (const c of Object.values(g.characters)) for (const cid of Object.keys(c.clues||{})) revealed[cid]=1;
  for (const id of C) if (!revealed[id]) e.push(`clue ${id} unobtainable`);
  const reach = new Set(Object.values(g.locations).filter(l=>l.unlocked).map(l=>l.id)), got = new Set();
  let ch = true; while (ch) { ch=false;
    for (const c of Object.values(g.characters)) if (reach.has(c.location)) for (const cid of Object.keys(c.clues||{})) if(!got.has(cid)){got.add(cid);ch=true;}
    for (const c of Object.values(g.clues)) if (got.has(c.id)&&c.unlocksLocation&&!reach.has(c.unlocksLocation)){reach.add(c.unlocksLocation);ch=true;}
  }
  for (const id of L) if (!reach.has(id)) e.push(`UNREACHABLE loc ${id}`);
  for (const id of C) if (!got.has(id)) e.push(`UNREACHABLE clue ${id}`);
  return e;
}
const errors = validate(g);
fs.writeFileSync(dataPath, JSON.stringify(g, null, 2));
console.log(`Added ${added}/5 nodes. Totals: ${Object.keys(g.locations).length} locations, ${Object.keys(g.characters).length} characters, ${Object.keys(g.clues).length} clues.`);
console.log('WARNINGS:', warn.length ? '\n  - ' + warn.join('\n  - ') : 'none');
console.log('VALIDATION:', errors.length ? '\n  ✗ ' + errors.join('\n  ✗ ') : 'VALID & SOLVABLE ✅');
process.exit(errors.length ? 1 : 0);
