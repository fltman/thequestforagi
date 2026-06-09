#!/usr/bin/env node
/**
 * apply_act5_patches.js
 *
 * Merges the Act V bridge patches into data/agi_game_data.json:
 *   - /tmp/agi_patches/b7_endings.json      (aiConfigUpdates: finaleNormativeQuestion, finaleEndings)
 *   - /tmp/agi_patches/b8_act5_bridge.json  (newLocations, newCharacters, newClues,
 *                                            locationUpdates, characterClueAdditions)
 *
 * Then validates referential integrity and runs a BFS reachability simulation
 * under ALL-of unlock semantics (location unlocks when ALL unlockedBy clues are
 * reachable; a clue is reachable when some character at a reachable location
 * holds it and all of that holder's requiresClues are already reachable).
 *
 * Usage:
 *   node scripts/apply_act5_patches.js            # dry run: apply in memory + validate
 *   node scripts/apply_act5_patches.js --write    # validate, write merged file, re-validate written file
 */

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'agi_game_data.json');
const PATCH_B7 = '/tmp/agi_patches/b7_endings.json';
const PATCH_B8 = '/tmp/agi_patches/b8_act5_bridge.json';

const WRITE = process.argv.includes('--write');

function fail(msg) {
  console.error('FAIL: ' + msg);
  process.exitCode = 1;
  failures.push(msg);
}
const failures = [];

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// ---------------------------------------------------------------------------
// Patch application
// ---------------------------------------------------------------------------

function applyPatches(data, b7, b8) {
  // b7: aiConfigUpdates — assign onto existing aiConfig
  if (b7.aiConfigUpdates) {
    Object.assign(data.aiConfig, b7.aiConfigUpdates);
  }

  // b8: newLocations / newCharacters / newClues — insert, collision = hard error
  for (const [section, target] of [
    ['newLocations', data.locations],
    ['newCharacters', data.characters],
    ['newClues', data.clues],
  ]) {
    for (const [id, obj] of Object.entries(b8[section] || {})) {
      if (Object.prototype.hasOwnProperty.call(target, id)) {
        throw new Error(`Collision: ${section} id "${id}" already exists in data`);
      }
      target[id] = obj;
    }
  }

  // b8: locationUpdates — assign onto existing locations
  for (const [id, upd] of Object.entries(b8.locationUpdates || {})) {
    if (!data.locations[id]) throw new Error(`locationUpdates target "${id}" does not exist`);
    Object.assign(data.locations[id], upd);
  }

  // b8: characterClueAdditions — insert into character clues map, collision = hard error
  for (const [charId, clueMap] of Object.entries(b8.characterClueAdditions || {})) {
    const ch = data.characters[charId];
    if (!ch) throw new Error(`characterClueAdditions target character "${charId}" does not exist`);
    ch.clues = ch.clues || {};
    for (const [clueId, entry] of Object.entries(clueMap)) {
      if (Object.prototype.hasOwnProperty.call(ch.clues, clueId)) {
        throw new Error(`Collision: character "${charId}" already holds clue "${clueId}"`);
      }
      ch.clues[clueId] = entry;
    }
  }

  return data;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validate(data, { newLocationIds, newCharacterIds, newClueIds }) {
  const locs = data.locations;
  const chars = data.characters;
  const clues = data.clues;
  const clueTypeIds = new Set(Object.keys(data.clueTypes));

  // Holders: clueId -> [{charId, requiresClues}]
  const holders = {};
  for (const [charId, ch] of Object.entries(chars)) {
    for (const [clueId, entry] of Object.entries(ch.clues || {})) {
      (holders[clueId] = holders[clueId] || []).push({
        charId,
        location: ch.location,
        requiresClues: (entry && entry.requiresClues) || [],
      });
    }
  }

  // 1. every unlockedBy id ∈ clues
  for (const [locId, loc] of Object.entries(locs)) {
    for (const cid of loc.unlockedBy || []) {
      if (!clues[cid]) fail(`location "${locId}" unlockedBy unknown clue "${cid}"`);
    }
  }

  // 2. every clue.unlocksLocation ∈ locations (or null)
  for (const [cid, clue] of Object.entries(clues)) {
    if (clue.unlocksLocation != null && !locs[clue.unlocksLocation]) {
      fail(`clue "${cid}" unlocksLocation unknown location "${clue.unlocksLocation}"`);
    }
  }

  // 3. every character.location ∈ locations; location.characters consistency
  for (const [charId, ch] of Object.entries(chars)) {
    if (!locs[ch.location]) fail(`character "${charId}" at unknown location "${ch.location}"`);
  }
  for (const [locId, loc] of Object.entries(locs)) {
    for (const charId of loc.characters || []) {
      if (!chars[charId]) fail(`location "${locId}" lists unknown character "${charId}"`);
      else if (chars[charId].location !== locId) {
        fail(`location "${locId}" lists character "${charId}" whose .location is "${chars[charId].location}"`);
      }
    }
  }

  // 4. every clue held by ≥1 character
  for (const cid of Object.keys(clues)) {
    if (!holders[cid] || holders[cid].length === 0) fail(`clue "${cid}" has no holders`);
  }
  // ...and every held clue id exists
  for (const cid of Object.keys(holders)) {
    if (!clues[cid]) fail(`character clue map references unknown clue "${cid}"`);
  }

  // 5. every requiresClues id ∈ clues
  for (const [charId, ch] of Object.entries(chars)) {
    for (const [clueId, entry] of Object.entries(ch.clues || {})) {
      for (const req of (entry && entry.requiresClues) || []) {
        if (!clues[req]) fail(`character "${charId}" clue "${clueId}" requiresClues unknown "${req}"`);
      }
    }
  }

  // 6. every gate clue (appears in any unlockedBy) has ≥2 holders
  const gateClues = new Set();
  for (const loc of Object.values(locs)) for (const cid of loc.unlockedBy || []) gateClues.add(cid);
  for (const cid of gateClues) {
    const n = (holders[cid] || []).length;
    if (n < 2) fail(`gate clue "${cid}" has ${n} holder(s), needs >=2`);
  }

  // 7. all new locations era 5 + required fields
  for (const id of newLocationIds) {
    const loc = locs[id];
    if (!loc) { fail(`new location "${id}" missing after merge`); continue; }
    if (loc.era !== 5) fail(`new location "${id}" era is ${loc.era}, expected 5`);
    if (loc.unlocked !== false) fail(`new location "${id}" unlocked must be false`);
    if (!Array.isArray(loc.coords) || loc.coords.length !== 2) fail(`new location "${id}" bad coords`);
    if (!loc.eraLabel) fail(`new location "${id}" missing eraLabel`);
  }

  // 8. exactly one finale clue
  const finaleClues = Object.entries(clues).filter(([, c]) => c.finale === true).map(([id]) => id);
  if (finaleClues.length !== 1) fail(`expected exactly 1 finale clue, found ${finaleClues.length}: ${finaleClues.join(', ')}`);

  // 9. new characters have systemPrompt + suggestedQuestions + openingLine
  for (const id of newCharacterIds) {
    const ch = chars[id];
    if (!ch) { fail(`new character "${id}" missing after merge`); continue; }
    if (!ch.systemPrompt || typeof ch.systemPrompt !== 'string') fail(`new character "${id}" missing systemPrompt`);
    if (!Array.isArray(ch.suggestedQuestions) || ch.suggestedQuestions.length < 3) fail(`new character "${id}" needs >=3 suggestedQuestions`);
    if (!ch.openingLine) fail(`new character "${id}" missing openingLine`);
    if (!ch.anonymousName) fail(`new character "${id}" missing anonymousName`);
  }

  // 10. clue types valid; linkedClues valid; new clues unlocksLocation null
  for (const [cid, clue] of Object.entries(clues)) {
    if (!clueTypeIds.has(clue.type)) fail(`clue "${cid}" has invalid type "${clue.type}"`);
    for (const lc of clue.linkedClues || []) {
      if (!clues[lc]) fail(`clue "${cid}" linkedClues references unknown "${lc}"`);
    }
  }
  for (const cid of newClueIds) {
    if (!clues[cid]) { fail(`new clue "${cid}" missing after merge`); continue; }
    if (clues[cid].unlocksLocation !== null) fail(`new clue "${cid}" unlocksLocation must be null`);
  }

  // 11. aiConfig finale additions present and well-formed
  const cfg = data.aiConfig;
  if (typeof cfg.finaleNormativeQuestion !== 'string' || !cfg.finaleNormativeQuestion.trim()) {
    fail('aiConfig.finaleNormativeQuestion missing/empty');
  }
  if (!Array.isArray(cfg.finaleEndings) || cfg.finaleEndings.length !== 9) {
    fail(`aiConfig.finaleEndings must have exactly 9 entries, found ${Array.isArray(cfg.finaleEndings) ? cfg.finaleEndings.length : 'none'}`);
  } else {
    const combos = new Set();
    for (const e of cfg.finaleEndings) {
      if (!['yes', 'no', 'conditional'].includes(e.stance)) fail(`finaleEnding bad stance "${e.stance}"`);
      if (!['low', 'mid', 'high'].includes(e.tier)) fail(`finaleEnding bad tier "${e.tier}"`);
      if (!e.title || !e.text) fail(`finaleEnding "${e.title || '?'}" missing title/text`);
      combos.add(`${e.stance}/${e.tier}`);
    }
    if (combos.size !== 9) fail(`finaleEndings must cover all 9 stance/tier combos, covered ${combos.size}`);
  }

  return { holders, finaleClues };
}

// ---------------------------------------------------------------------------
// BFS reachability under ALL-of semantics
// ---------------------------------------------------------------------------

function bfs(data) {
  const locs = data.locations;
  const chars = data.characters;
  const clues = data.clues;

  // holders per clue with per-holder requiresClues
  const holders = {};
  for (const ch of Object.values(chars)) {
    for (const [clueId, entry] of Object.entries(ch.clues || {})) {
      (holders[clueId] = holders[clueId] || []).push({
        location: ch.location,
        requiresClues: (entry && entry.requiresClues) || [],
      });
    }
  }

  const reachableLocs = new Map(); // locId -> depth
  const reachableClues = new Set();

  for (const [id, loc] of Object.entries(locs)) {
    if (loc.unlocked === true) reachableLocs.set(id, 0);
  }

  let depth = 0;
  for (;;) {
    // Clue fixpoint at current set of reachable locations
    let changed = true;
    while (changed) {
      changed = false;
      for (const [clueId, hs] of Object.entries(holders)) {
        if (reachableClues.has(clueId)) continue;
        const ok = hs.some(
          (h) => reachableLocs.has(h.location) && h.requiresClues.every((r) => reachableClues.has(r))
        );
        if (ok) {
          reachableClues.add(clueId);
          changed = true;
        }
      }
    }

    // Unlock all locations whose full unlockedBy set is satisfied
    const newly = [];
    for (const [id, loc] of Object.entries(locs)) {
      if (reachableLocs.has(id)) continue;
      const gates = loc.unlockedBy || [];
      if (gates.length > 0 && gates.every((c) => reachableClues.has(c))) newly.push(id);
    }
    if (newly.length === 0) break;
    depth += 1;
    for (const id of newly) reachableLocs.set(id, depth);
  }

  const unreachableLocs = Object.keys(locs).filter((id) => !reachableLocs.has(id));
  const unobtainableClues = Object.keys(clues).filter((id) => !reachableClues.has(id));

  return { reachableLocs, reachableClues, unreachableLocs, unobtainableClues };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

function validateAndReport(data, ids, label) {
  console.log(`\n===== ${label} =====`);
  validate(data, ids);

  const { reachableLocs, unreachableLocs, unobtainableClues } = bfs(data);

  // Depth table
  const byDepth = {};
  for (const [id, d] of reachableLocs.entries()) (byDepth[d] = byDepth[d] || []).push(id);
  console.log('\nBFS depth table:');
  for (const d of Object.keys(byDepth).map(Number).sort((a, b) => a - b)) {
    console.log(`  ${String(d).padStart(2)}  ${byDepth[d].sort().join(', ')}`);
  }
  console.log(`\nLocations: ${Object.keys(data.locations).length} total, ${reachableLocs.size} reachable`);
  if (unreachableLocs.length) fail(`unreachable locations: ${unreachableLocs.join(', ')}`);
  else console.log('Unreachable locations: NONE');
  if (unobtainableClues.length) fail(`unobtainable clues: ${unobtainableClues.join(', ')}`);
  else console.log('Unobtainable clues: NONE');

  if (Object.keys(data.locations).length !== 27) {
    fail(`expected 27 locations after merge, found ${Object.keys(data.locations).length}`);
  }

  const dA = reachableLocs.get('aurora_campus_2045');
  const dL = reachableLocs.get('lagrange_shipyard_2142');
  const dD = reachableLocs.get('dyson_swarm_2387');
  console.log(`\nAct V chain: aurora_campus_2045=${dA}  lagrange_shipyard_2142=${dL}  dyson_swarm_2387=${dD}`);
  if (!(dA != null && dL != null && dD != null && dA < dL && dL < dD)) {
    fail(`Act V ordering violated: aurora=${dA}, lagrange=${dL}, dyson=${dD} (need aurora < lagrange < dyson)`);
  }

  // Finale clue location reachable
  const finaleClueId = Object.keys(data.clues).find((id) => data.clues[id].finale === true);
  console.log(`Finale clue: ${finaleClueId}`);

  return { dA, dL, dD };
}

function main() {
  const data = loadJson(DATA_PATH);
  const b7 = loadJson(PATCH_B7);
  const b8 = loadJson(PATCH_B8);

  const ids = {
    newLocationIds: Object.keys(b8.newLocations || {}),
    newCharacterIds: Object.keys(b8.newCharacters || {}),
    newClueIds: Object.keys(b8.newClues || {}),
  };

  applyPatches(data, b7, b8);
  validateAndReport(data, ids, 'MERGED (in memory)');

  if (failures.length) {
    console.error(`\n${failures.length} validation failure(s). Not writing.`);
    process.exit(1);
  }

  if (WRITE) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log(`\nWrote merged data to ${DATA_PATH}`);

    // Re-validate the written file from disk
    delete require.cache && null;
    const reread = loadJson(DATA_PATH);
    validateAndReport(reread, ids, 'WRITTEN FILE (re-read from disk)');
    if (failures.length) {
      console.error(`\n${failures.length} validation failure(s) in written file.`);
      process.exit(1);
    }
  }

  console.log('\nALL VALIDATIONS PASSED' + (WRITE ? ' (file written)' : ' (dry run, use --write to persist)'));
}

main();
