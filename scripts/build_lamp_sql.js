#!/usr/bin/env node
/**
 * Generates a single self-contained MySQL import (schema + all game data) for the AGI game,
 * so it can be imported on one.com via phpMyAdmin without shell/PHP access.
 * Output: deploy/lamp/sql/agi_game.sql
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const g = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/agi_game_data.json'), 'utf8'));
const schema = fs.readFileSync(path.join(ROOT, 'deploy/lamp/sql/schema.sql'), 'utf8');

const esc = v => (v === null || v === undefined)
  ? 'NULL'
  : "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '').replace(/\n/g, '\\n') + "'";

const out = [];
out.push('-- The Quest for AGI — complete MySQL import (schema + data).');
out.push('-- Create an (empty) database, select it in phpMyAdmin, then Import this file.');
out.push('SET NAMES utf8mb4;');
out.push('SET FOREIGN_KEY_CHECKS=0;');
['player_conversations','player_notebook','player_board','player_state','players',
 'character_clues','clue_links','location_unlock_clues','characters','clues','locations','clue_types','ai_config']
  .forEach(t => out.push('DROP TABLE IF EXISTS `' + t + '`;'));
out.push(schema.trim());
out.push('');

// ai_config: generic loop (mirrors server/db/seed.js) — strings as-is, everything else JSON,
// plus meta_* rows from the data file's meta block.
const cfg = Object.entries(g.aiConfig || {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]);
if (g.meta) {
  if (g.meta.title != null) cfg.push(['meta_title', String(g.meta.title)]);
  if (g.meta.subtitle != null) cfg.push(['meta_subtitle', String(g.meta.subtitle)]);
  if (g.meta.language != null) cfg.push(['meta_language', String(g.meta.language)]);
}
out.push('INSERT INTO ai_config (`key`,value) VALUES ' + cfg.map(([k,v]) => `(${esc(k)},${esc(v)})`).join(',') + ';');

out.push('INSERT INTO clue_types (id,label,color,icon) VALUES ' +
  Object.entries(g.clueTypes).map(([id,c]) => `(${esc(id)},${esc(c.label)},${esc(c.color)},${esc(c.icon)})`).join(',') + ';');

out.push('INSERT INTO locations (id,name,description,lat,lng,type,unlocked_by_default,era,era_label) VALUES ' +
  Object.values(g.locations).map(l =>
    `(${esc(l.id)},${esc(l.name)},${esc(l.description)},${l.coords[0]},${l.coords[1]},${esc(l.type)},${l.unlocked?1:0},${l.era==null?'NULL':Number(l.era)},${esc(l.eraLabel ?? null)})`
  ).join(',') + ';');

out.push('INSERT INTO clues (id,title,description,type,unlocks_location_id,finale) VALUES ' +
  Object.values(g.clues).map(c =>
    `(${esc(c.id)},${esc(c.title)},${esc(c.description)},${esc(c.type)},${c.unlocksLocation?esc(c.unlocksLocation):'NULL'},${c.finale?1:0})`
  ).join(',') + ';');

const seen = new Set(); const links = [];
Object.values(g.clues).forEach(c => (c.linkedClues||[]).forEach(l => { const k = c.id+'|'+l; if (!seen.has(k)) { seen.add(k); links.push([c.id,l]); } }));
if (links.length) out.push('INSERT INTO clue_links (clue_id,linked_clue_id) VALUES ' + links.map(([a,b]) => `(${esc(a)},${esc(b)})`).join(',') + ';');

const unlocks = [];
Object.values(g.locations).forEach(l => (l.unlockedBy||[]).forEach(c => unlocks.push([l.id,c])));
if (unlocks.length) out.push('INSERT INTO location_unlock_clues (location_id,clue_id) VALUES ' + unlocks.map(([a,b]) => `(${esc(a)},${esc(b)})`).join(',') + ';');

out.push('INSERT INTO characters (id,name,anonymous_name,role,location_id,portrait_mood,system_prompt,suggested_questions,opening_line) VALUES ' +
  Object.values(g.characters).map(c =>
    `(${esc(c.id)},${esc(c.name)},${esc(c.anonymousName||'Unknown')},${esc(c.role)},${esc(c.location)},${esc(c.portrait_mood||'')},${esc(c.systemPrompt)},${c.suggestedQuestions?esc(JSON.stringify(c.suggestedQuestions)):'NULL'},${esc(c.openingLine ?? null)})`
  ).join(',') + ';');

const ccs = [];
Object.values(g.characters).forEach(c => Object.entries(c.clues||{}).forEach(([cid,d]) =>
  ccs.push([c.id, cid, d.triggerCondition, d.knowledge, d.requiresClues ? JSON.stringify(d.requiresClues) : null])));
out.push('INSERT INTO character_clues (character_id,clue_id,trigger_condition,knowledge,requires_clues) VALUES ' +
  ccs.map(([a,b,t,k,r]) => `(${esc(a)},${esc(b)},${esc(t)},${k==null?'NULL':esc(k)},${r==null?'NULL':esc(r)})`).join(',') + ';');

out.push('SET FOREIGN_KEY_CHECKS=1;');

const outPath = path.join(ROOT, 'deploy/lamp/sql/agi_game.sql');
fs.writeFileSync(outPath, out.join('\n') + '\n');
console.log('wrote', outPath, fs.statSync(outPath).size, 'bytes');
console.log(`  ${Object.keys(g.locations).length} locations, ${Object.keys(g.characters).length} characters, ${Object.keys(g.clues).length} clues, ${links.length} links, ${ccs.length} char-clues`);
