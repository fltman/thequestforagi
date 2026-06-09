#!/usr/bin/env node
/**
 * apply_gameplay_patches.js
 *
 * Merges the six gameplay patch files from /tmp/agi_patches into
 * data/agi_game_data.json, validates the result (referential integrity +
 * BFS reachability under ALL-of unlock semantics), and writes it back.
 *
 * Patch order: b2, b1, b4, b5, b3a, b3b (+ optional fixup.json last).
 *
 * Idempotent: the first run backs up the original to
 * /tmp/agi_patches/agi_game_data.pre_merge.json; subsequent runs re-merge
 * from that backup instead of the (already merged) data file.
 *
 * Usage:
 *   node scripts/apply_gameplay_patches.js                  merge + validate + write
 *   node scripts/apply_gameplay_patches.js --validate-only  validate data file as-is
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'agi_game_data.json');
const PATCH_DIR = '/tmp/agi_patches';
const BACKUP_FILE = path.join(PATCH_DIR, 'agi_game_data.pre_merge.json');

const PATCH_ORDER = [
  'b2_gating_era_finale.json',
  'b1_redundant_holders.json',
  'b4_echo_clues.json',
  'b5_thin_locations.json',
  'b3a_questions_openers_first.json',
  'b3b_questions_openers_second.json',
  'fixup.json', // optional, applied last if present
];

const warnings = [];
const errors = [];
function warn(msg) { warnings.push(msg); console.warn('  WARN  ' + msg); }
function fail(msg) { errors.push(msg); console.error('  ERROR ' + msg); }

// ---------------------------------------------------------------- merging

function applyPatch(d, patch, patchName) {
  const isB1 = patchName.startsWith('b1_');

  if (patch.newClues) {
    for (const [id, clue] of Object.entries(patch.newClues)) {
      if (d.clues[id]) throw new Error(`[${patchName}] newClues id collision: ${id}`);
      d.clues[id] = Object.assign({ id }, clue);
      if (d.clues[id].id !== id) throw new Error(`[${patchName}] newClues ${id} has mismatched id field: ${clue.id}`);
    }
  }

  if (patch.clueUpdates) {
    for (const [id, upd] of Object.entries(patch.clueUpdates)) {
      if (!d.clues[id]) throw new Error(`[${patchName}] clueUpdates target missing: ${id}`);
      Object.assign(d.clues[id], upd);
    }
  }

  if (patch.locationUpdates) {
    for (const [id, upd] of Object.entries(patch.locationUpdates)) {
      if (!d.locations[id]) throw new Error(`[${patchName}] locationUpdates target missing: ${id}`);
      Object.assign(d.locations[id], upd);
    }
  }

  if (patch.characterUpdates) {
    for (const [id, upd] of Object.entries(patch.characterUpdates)) {
      if (!d.characters[id]) {
        warn(`[${patchName}] characterUpdates target missing, skipped: ${id}`);
        continue;
      }
      Object.assign(d.characters[id], upd);
    }
  }

  if (patch.characterClueAdditions) {
    for (const [charId, additions] of Object.entries(patch.characterClueAdditions)) {
      const ch = d.characters[charId];
      if (!ch) throw new Error(`[${patchName}] characterClueAdditions character missing: ${charId}`);
      if (!ch.clues) ch.clues = {};
      for (const [clueId, entry] of Object.entries(additions)) {
        if (ch.clues[clueId]) {
          if (isB1) {
            warn(`[${patchName}] ${charId} already holds ${clueId}, skipped`);
            continue;
          }
          throw new Error(`[${patchName}] ${charId} already holds ${clueId}`);
        }
        ch.clues[clueId] = entry;
      }
    }
  }

  if (patch.characterClueUpdates) {
    // shallow-merge fields onto an EXISTING character clue entry (fixup layer)
    for (const [charId, updates] of Object.entries(patch.characterClueUpdates)) {
      const ch = d.characters[charId];
      if (!ch) throw new Error(`[${patchName}] characterClueUpdates character missing: ${charId}`);
      for (const [clueId, upd] of Object.entries(updates)) {
        if (!ch.clues || !ch.clues[clueId]) {
          throw new Error(`[${patchName}] characterClueUpdates target entry missing: ${charId}/${clueId}`);
        }
        Object.assign(ch.clues[clueId], upd);
      }
    }
  }

  if (patch.aiConfigUpdates) {
    for (const [key, value] of Object.entries(patch.aiConfigUpdates)) {
      d.aiConfig[key] = value;
    }
  }
}

// ------------------------------------------------------------- validation

function holdersOf(d, clueId) {
  return Object.values(d.characters).filter((ch) => ch.clues && ch.clues[clueId]);
}

function validate(d) {
  warnings.length = 0;
  errors.length = 0;

  // JSON serializable
  try {
    JSON.stringify(d);
  } catch (e) {
    fail('data is not JSON-serializable: ' + e.message);
    return { ok: false };
  }

  // clue.unlocksLocation refers to a real location
  for (const [id, clue] of Object.entries(d.clues)) {
    if (clue.unlocksLocation && !d.locations[clue.unlocksLocation]) {
      fail(`clue ${id} unlocksLocation unknown: ${clue.unlocksLocation}`);
    }
    if (clue.type && !d.clueTypes[clue.type]) {
      fail(`clue ${id} has unknown type: ${clue.type}`);
    }
    for (const link of clue.linkedClues || []) {
      if (!d.clues[link]) warn(`clue ${id} linkedClues references unknown clue: ${link}`);
    }
  }

  // location unlockedBy ids are clues
  for (const [id, loc] of Object.entries(d.locations)) {
    for (const cid of loc.unlockedBy || []) {
      if (!d.clues[cid]) fail(`location ${id} unlockedBy unknown clue: ${cid}`);
    }
    if (!(Number.isInteger(loc.era) && loc.era >= 1 && loc.era <= 5)) {
      fail(`location ${id} missing valid era (1-5): ${JSON.stringify(loc.era)}`);
    }
    if (!loc.eraLabel) fail(`location ${id} missing eraLabel`);
  }

  // character clue ids, requiresClues, locations, suggestedQuestions
  for (const [id, ch] of Object.entries(d.characters)) {
    if (!d.locations[ch.location]) warn(`character ${id} at unknown location: ${ch.location}`);
    if (!Array.isArray(ch.suggestedQuestions) || ch.suggestedQuestions.length === 0) {
      warn(`character ${id} missing suggestedQuestions`);
    }
    if (typeof ch.openingLine !== 'string' || !ch.openingLine) {
      warn(`character ${id} missing openingLine`);
    }
    for (const [clueId, entry] of Object.entries(ch.clues || {})) {
      if (!d.clues[clueId]) fail(`character ${id} holds unknown clue: ${clueId}`);
      for (const req of entry.requiresClues || []) {
        if (!d.clues[req]) fail(`character ${id} clue ${clueId} requiresClues unknown clue: ${req}`);
      }
    }
  }

  // every clue held by >= 1 character
  for (const id of Object.keys(d.clues)) {
    if (holdersOf(d, id).length === 0) fail(`orphan clue (no holder, cannot be revealed): ${id}`);
  }

  // exactly one finale clue
  const finaleClues = Object.values(d.clues).filter((c) => c.finale === true);
  if (finaleClues.length !== 1) {
    fail(`expected exactly 1 finale clue, found ${finaleClues.length}: ${finaleClues.map((c) => c.id).join(', ')}`);
  }

  // gate clues should have >= 2 holders (warn only)
  const gateClues = new Set();
  for (const loc of Object.values(d.locations)) {
    for (const cid of loc.unlockedBy || []) gateClues.add(cid);
  }
  for (const cid of gateClues) {
    const n = holdersOf(d, cid).length;
    if (n < 2) warn(`gate clue ${cid} has only ${n} holder(s)`);
  }

  // ---- BFS reachability (ALL-of semantics) ----
  const locDepth = {};
  const reachableClues = new Set();
  for (const [id, loc] of Object.entries(d.locations)) {
    if (loc.unlocked) locDepth[id] = 0;
  }
  if (Object.keys(locDepth).length === 0) fail('no default-unlocked location');

  // characters grouped by location
  const charsByLoc = {};
  for (const ch of Object.values(d.characters)) {
    (charsByLoc[ch.location] = charsByLoc[ch.location] || []).push(ch);
  }

  let depth = 0;
  for (let round = 0; round < 100; round++) {
    // fixed-point clue expansion from currently reachable locations
    let grew = true;
    while (grew) {
      grew = false;
      for (const locId of Object.keys(locDepth)) {
        for (const ch of charsByLoc[locId] || []) {
          for (const [clueId, entry] of Object.entries(ch.clues || {})) {
            if (reachableClues.has(clueId) || !d.clues[clueId]) continue;
            const reqs = entry.requiresClues || [];
            if (reqs.every((r) => reachableClues.has(r))) {
              reachableClues.add(clueId);
              grew = true;
            }
          }
        }
      }
    }
    // unlock locations whose ALL unlockedBy clues are reachable
    let unlockedNew = false;
    for (const [id, loc] of Object.entries(d.locations)) {
      if (locDepth[id] !== undefined) continue;
      const reqs = loc.unlockedBy || [];
      if (reqs.length > 0 && reqs.every((c) => reachableClues.has(c))) {
        locDepth[id] = depth + 1;
        unlockedNew = true;
      }
    }
    if (!unlockedNew) break;
    depth++;
  }

  // depth table
  const byDepth = {};
  for (const [id, dpt] of Object.entries(locDepth)) {
    (byDepth[dpt] = byDepth[dpt] || []).push(id);
  }
  console.log('\n  BFS depth table (ALL-of semantics):');
  for (const dpt of Object.keys(byDepth).map(Number).sort((a, b) => a - b)) {
    console.log(`    d${dpt}: ${byDepth[dpt].sort().join(', ')}`);
  }

  // every location reachable
  const unreachableLocs = Object.keys(d.locations).filter((id) => locDepth[id] === undefined);
  if (unreachableLocs.length > 0) fail('unreachable locations: ' + unreachableLocs.join(', '));

  // unreachable clues (held only at unreachable locations / broken requires chains)
  const unreachableClues = Object.keys(d.clues).filter((id) => !reachableClues.has(id));
  if (unreachableClues.length > 0) warn('unreachable clues: ' + unreachableClues.join(', '));

  // finale clue's location depth >= 7
  let finaleDepth = null;
  if (finaleClues.length === 1) {
    const fid = finaleClues[0].id;
    const depths = holdersOf(d, fid)
      .map((ch) => locDepth[ch.location])
      .filter((x) => x !== undefined);
    if (depths.length === 0) {
      fail(`finale clue ${fid} has no holder at a reachable location`);
    } else {
      finaleDepth = Math.min(...depths);
      console.log(`\n  finale clue ${fid} at depth ${finaleDepth}`);
      if (finaleDepth < 7) fail(`finale clue ${fid} location depth ${finaleDepth} < 7`);
    }
  }

  return { ok: errors.length === 0, locDepth, finaleDepth };
}

// ------------------------------------------------------------------ main

function summarize(d) {
  console.log(`\n  counts: ${Object.keys(d.locations).length} locations, ` +
    `${Object.keys(d.characters).length} characters, ${Object.keys(d.clues).length} clues`);
}

function main() {
  const validateOnly = process.argv.includes('--validate-only');

  if (validateOnly) {
    console.log('Validating ' + DATA_FILE);
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const res = validate(d);
    summarize(d);
    console.log(res.ok ? '\nVALIDATION PASSED' + (warnings.length ? ` (${warnings.length} warnings)` : '') : '\nVALIDATION FAILED');
    process.exit(res.ok ? 0 : 1);
  }

  // back up original once; re-runs merge from the backup (idempotent)
  let source;
  if (fs.existsSync(BACKUP_FILE)) {
    console.log('Backup exists, merging from ' + BACKUP_FILE);
    source = BACKUP_FILE;
  } else {
    fs.copyFileSync(DATA_FILE, BACKUP_FILE);
    console.log('Backed up original to ' + BACKUP_FILE);
    source = DATA_FILE;
  }
  const d = JSON.parse(fs.readFileSync(source, 'utf8'));

  for (const name of PATCH_ORDER) {
    const p = path.join(PATCH_DIR, name);
    if (!fs.existsSync(p)) {
      if (name === 'fixup.json') continue;
      throw new Error('missing patch file: ' + p);
    }
    console.log('Applying ' + name);
    applyPatch(d, JSON.parse(fs.readFileSync(p, 'utf8')), name);
  }

  console.log('\nValidating merged data...');
  const res = validate(d);
  summarize(d);
  if (!res.ok) {
    console.error(`\nVALIDATION FAILED (${errors.length} errors) — data NOT written`);
    process.exit(1);
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2) + '\n');
  console.log('\nWrote ' + DATA_FILE);

  // final re-validation from the written file
  console.log('\nRe-validating written file...');
  const d2 = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const res2 = validate(d2);
  if (!res2.ok) {
    console.error('\nRE-VALIDATION FAILED');
    process.exit(1);
  }
  console.log(`\nVALIDATION PASSED${warnings.length ? ` (${warnings.length} warnings)` : ''}`);
}

main();
