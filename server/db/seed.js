const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const SCHEMA = require('./schema');

const DB_PATH = process.env.GAME_DB ? path.resolve(process.env.GAME_DB) : path.join(__dirname, 'palme.db');
const DATA_PATH = process.env.GAME_DATA ? path.resolve(process.env.GAME_DATA) : path.join(__dirname, '..', '..', 'data', 'palme_game_data_v2.json');

// Remove existing db
if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(SCHEMA);

// Load JSON data
const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));

// Seed ai_config
const insertConfig = db.prepare('INSERT INTO ai_config (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(data.aiConfig || {})) {
  insertConfig.run(key, typeof value === 'string' ? value : JSON.stringify(value));
}
if (data.meta) {
  if (data.meta.title != null) insertConfig.run('meta_title', String(data.meta.title));
  if (data.meta.subtitle != null) insertConfig.run('meta_subtitle', String(data.meta.subtitle));
  if (data.meta.language != null) insertConfig.run('meta_language', String(data.meta.language));
}

// Seed clue_types
const insertClueType = db.prepare('INSERT INTO clue_types (id, label, color, icon) VALUES (?, ?, ?, ?)');
for (const [id, ct] of Object.entries(data.clueTypes)) {
  insertClueType.run(id, ct.label, ct.color, ct.icon);
}

// Seed locations
const insertLocation = db.prepare(
  'INSERT INTO locations (id, name, description, lat, lng, type, unlocked_by_default, era, era_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
for (const [id, loc] of Object.entries(data.locations)) {
  insertLocation.run(
    id, loc.name, loc.description, loc.coords[0], loc.coords[1], loc.type,
    loc.unlocked ? 1 : 0, loc.era ?? null, loc.eraLabel ?? null
  );
}

// Seed clues
const insertClue = db.prepare(
  'INSERT INTO clues (id, title, description, type, unlocks_location_id, finale) VALUES (?, ?, ?, ?, ?, ?)'
);
for (const [id, clue] of Object.entries(data.clues)) {
  insertClue.run(id, clue.title, clue.description, clue.type, clue.unlocksLocation || null, clue.finale ? 1 : 0);
}

// Seed clue_links
const insertClueLink = db.prepare('INSERT INTO clue_links (clue_id, linked_clue_id) VALUES (?, ?)');
for (const [id, clue] of Object.entries(data.clues)) {
  for (const linked of clue.linkedClues || []) {
    insertClueLink.run(id, linked);
  }
}

// Seed location_unlock_clues
const insertLocUnlock = db.prepare('INSERT INTO location_unlock_clues (location_id, clue_id) VALUES (?, ?)');
for (const [id, loc] of Object.entries(data.locations)) {
  for (const clueId of loc.unlockedBy || []) {
    insertLocUnlock.run(id, clueId);
  }
}

// Seed characters
const insertChar = db.prepare(
  'INSERT INTO characters (id, name, anonymous_name, role, location_id, portrait_mood, system_prompt, suggested_questions, opening_line) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
const insertCharClue = db.prepare(
  'INSERT INTO character_clues (character_id, clue_id, trigger_condition, knowledge, requires_clues) VALUES (?, ?, ?, ?, ?)'
);

for (const [id, char] of Object.entries(data.characters)) {
  insertChar.run(
    id, char.name, char.anonymousName || 'Okänd', char.role, char.location, char.portrait_mood, char.systemPrompt,
    char.suggestedQuestions ? JSON.stringify(char.suggestedQuestions) : null,
    char.openingLine ?? null
  );
  for (const [clueId, clueData] of Object.entries(char.clues || {})) {
    insertCharClue.run(
      id, clueId, clueData.triggerCondition, clueData.knowledge || null,
      clueData.requiresClues ? JSON.stringify(clueData.requiresClues) : null
    );
  }
}

db.close();
console.log(`Database seeded at ${DB_PATH}`);
console.log(`  ${Object.keys(data.locations).length} locations`);
console.log(`  ${Object.keys(data.characters).length} characters`);
console.log(`  ${Object.keys(data.clues).length} clues`);
console.log(`  ${Object.keys(data.clueTypes).length} clue types`);
