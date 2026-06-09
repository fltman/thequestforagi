#!/usr/bin/env node
/**
 * Merge the validated skeleton + the prose-workflow output into the engine's
 * exact game-data JSON, then re-validate (integrity + BFS solvability + prose completeness).
 *
 * Usage: node scripts/assemble_agi_game.js <skeleton.json> <prose-output.json> <out.json>
 */
const fs = require('fs');

const [skPath, prosePath, outPath] = process.argv.slice(2);
if (!skPath || !prosePath || !outPath) {
  console.error('Usage: node scripts/assemble_agi_game.js <skeleton.json> <prose-output.json> <out.json>');
  process.exit(1);
}

const sk = JSON.parse(fs.readFileSync(skPath, 'utf8'));
const proseRaw = JSON.parse(fs.readFileSync(prosePath, 'utf8'));
const prose = proseRaw.result || proseRaw;
const bundles = prose.bundles || [];
const aiConfig = prose.aiConfig || {};

// ---- lookups from prose ----
const charProse = {};   // charId -> {name, role, systemPrompt, portrait_mood, anonymousName, clues:[{clueId,triggerCondition,knowledge}]}
const clueProse = {};   // clueId -> {title, description}
const locProse = {};    // locId -> {name, description}
for (const b of bundles) {
  if (!b) continue;
  if (b.locationId) locProse[b.locationId] = { name: b.name, description: b.description };
  for (const c of (b.characters || [])) charProse[c.id] = c;
  for (const cl of (b.clues || [])) { if (!clueProse[cl.clueId]) clueProse[cl.clueId] = { title: cl.title, description: cl.description }; }
}

const charsByLoc = {};
sk.characters.forEach(c => { (charsByLoc[c.location] = charsByLoc[c.location] || []).push(c.id); });

const warnings = [];

// ---- build engine JSON ----
const out = {
  meta: {
    title: 'The Quest for AGI',
    subtitle: 'A time-travel investigation through the history and future of artificial general intelligence',
    language: 'en',
    startDate: '2022-11-30',
    version: 1,
  },
  aiConfig: {
    chatModel: 'anthropic/claude-haiku-4.5',
    analysisModel: 'anthropic/claude-haiku-4.5',
    chatMaxTokens: 500,
    analysisMaxTokens: 300,
    globalChatSystemPrefix: aiConfig.globalChatSystemPrefix || '',
    analysisSystemPrompt: aiConfig.analysisSystemPrompt || '',
  },
  clueTypes: {},
  locations: {},
  characters: {},
  clues: {},
};

// clueTypes
for (const t of sk.clueTypes) out.clueTypes[t.id] = { label: t.label, color: t.color, icon: t.icon };

// locations
for (const l of sk.locations) {
  const p = locProse[l.id] || {};
  if (!p.name) warnings.push(`location ${l.id}: missing prose (name/description)`);
  out.locations[l.id] = {
    id: l.id,
    name: p.name || l.name,
    description: p.description || '',
    coords: [l.lat, l.lng],
    type: l.type,
    unlocked: !!l.unlocked,
    unlockedBy: l.unlockedBy || [],
    characters: charsByLoc[l.id] || [],
  };
}

// clues
for (const c of sk.clues) {
  const p = clueProse[c.id] || {};
  if (!p.title || !p.description) warnings.push(`clue ${c.id}: missing prose title/description`);
  out.clues[c.id] = {
    id: c.id,
    title: p.title || c.title,
    description: p.description || '',
    type: c.type,
    unlocksLocation: c.unlocksLocation || null,
    linkedClues: c.linkedClues || [],
  };
}

// characters
for (const c of sk.characters) {
  const p = charProse[c.id] || {};
  if (!p.systemPrompt) warnings.push(`character ${c.id}: missing prose (systemPrompt)`);
  const cluesMap = {};
  for (const cc of (p.clues || [])) {
    if (!c.reveals.includes(cc.clueId)) { warnings.push(`character ${c.id}: prose clue ${cc.clueId} not in skeleton reveals`); continue; }
    cluesMap[cc.clueId] = { triggerCondition: cc.triggerCondition, knowledge: cc.knowledge };
  }
  // ensure every skeleton-assigned clue has a trigger entry
  for (const cid of c.reveals) if (!cluesMap[cid]) warnings.push(`character ${c.id}: skeleton clue ${cid} has no prose trigger/knowledge`);
  out.characters[c.id] = {
    id: c.id,
    name: p.name || c.name,
    role: p.role || c.role,
    location: c.location,
    portrait_mood: p.portrait_mood || '',
    systemPrompt: p.systemPrompt || '',
    anonymousName: p.anonymousName || 'Unknown',
    clues: cluesMap,
  };
}

// ---- validate (integrity + BFS solvability) on final shape ----
function validate(g) {
  const errors = [];
  const locIds = new Set(Object.keys(g.locations));
  const clueIds = new Set(Object.keys(g.clues));
  const charIds = new Set(Object.keys(g.characters));
  const typeIds = new Set(Object.keys(g.clueTypes));
  if (locIds.size !== 20) errors.push(`expected 20 locations, got ${locIds.size}`);
  if (charIds.size !== 50) errors.push(`expected 50 characters, got ${charIds.size}`);
  if (clueIds.size !== 80) errors.push(`expected 80 clues, got ${clueIds.size}`);
  for (const c of Object.values(g.characters)) {
    if (!locIds.has(c.location)) errors.push(`char ${c.id} -> unknown location ${c.location}`);
    for (const cid of Object.keys(c.clues || {})) if (!clueIds.has(cid)) errors.push(`char ${c.id} clue ${cid} unknown`);
  }
  for (const c of Object.values(g.clues)) {
    if (!typeIds.has(c.type)) errors.push(`clue ${c.id} unknown type ${c.type}`);
    if (c.unlocksLocation && !locIds.has(c.unlocksLocation)) errors.push(`clue ${c.id} unlocks unknown ${c.unlocksLocation}`);
    for (const l of (c.linkedClues || [])) if (!clueIds.has(l)) errors.push(`clue ${c.id} links unknown ${l}`);
  }
  // every clue revealed by >=1 char
  const revealed = {};
  for (const c of Object.values(g.characters)) for (const cid of Object.keys(c.clues || {})) revealed[cid] = true;
  for (const id of clueIds) if (!revealed[id]) errors.push(`clue ${id} revealed by no character`);
  // BFS solvability
  const defaults = Object.values(g.locations).filter(l => l.unlocked).map(l => l.id);
  if (defaults.length !== 1) errors.push(`expected exactly 1 default location, got ${defaults.length}`);
  const reach = new Set(defaults), got = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of Object.values(g.characters)) if (reach.has(c.location)) for (const cid of Object.keys(c.clues || {})) if (!got.has(cid)) { got.add(cid); changed = true; }
    for (const c of Object.values(g.clues)) if (got.has(c.id) && c.unlocksLocation && !reach.has(c.unlocksLocation)) { reach.add(c.unlocksLocation); changed = true; }
  }
  for (const id of locIds) if (!reach.has(id)) errors.push(`UNREACHABLE location ${id}`);
  for (const id of clueIds) if (!got.has(id)) errors.push(`UNREACHABLE clue ${id}`);
  return errors;
}

const errors = validate(out);

fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

console.log(`\n=== ASSEMBLY ===`);
console.log(`locations: ${Object.keys(out.locations).length}  characters: ${Object.keys(out.characters).length}  clues: ${Object.keys(out.clues).length}  clueTypes: ${Object.keys(out.clueTypes).length}`);
console.log(`bundles received: ${bundles.length}/20`);
console.log(`aiConfig: globalPrefix ${out.aiConfig.globalChatSystemPrefix.length} chars, analysisPrompt ${out.aiConfig.analysisSystemPrompt.length} chars`);
console.log(`wrote -> ${outPath}`);
console.log(`\nWARNINGS (${warnings.length}):`);
warnings.slice(0, 40).forEach(w => console.log('  - ' + w));
if (warnings.length > 40) console.log(`  ... +${warnings.length - 40} more`);
console.log(`\nVALIDATION ERRORS (${errors.length}):`);
errors.forEach(e => console.log('  ✗ ' + e));
console.log(errors.length ? '\n❌ INVALID' : '\n✅ VALID & SOLVABLE');
process.exit(errors.length ? 1 : 0);
