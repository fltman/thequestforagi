const express = require('express');
const { getDb } = require('../db/connection');

const router = express.Router();

// GET /api/config — AI config (without API key)
router.get('/config', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM ai_config').all();
  const config = {};
  for (const row of rows) {
    config[row.key] = row.value;
  }
  config.hasServerKey = !!process.env.OPENROUTER_API_KEY;
  if (config.meta_title != null) config.metaTitle = config.meta_title;
  if (config.meta_subtitle != null) config.metaSubtitle = config.meta_subtitle;
  if (config.meta_language != null) config.metaLanguage = config.meta_language;
  // Never expose the finale material (answer keys, the last question, ending texts)
  delete config.finaleQuestions;
  delete config.finaleNormativeQuestion;
  delete config.finaleEndings;
  config.charactersTotal = db.prepare('SELECT COUNT(*) AS n FROM characters').get().n;
  res.json(config);
});

// GET /api/clue-types
router.get('/clue-types', (req, res) => {
  const db = getDb();
  const types = db.prepare('SELECT * FROM clue_types').all();
  res.json(types);
});

// GET /api/locations
router.get('/locations', (req, res) => {
  const db = getDb();
  const locations = db.prepare('SELECT * FROM locations').all();
  const unlockClues = db.prepare('SELECT * FROM location_unlock_clues').all();

  const unlockMap = {};
  for (const uc of unlockClues) {
    if (!unlockMap[uc.location_id]) unlockMap[uc.location_id] = [];
    unlockMap[uc.location_id].push(uc.clue_id);
  }

  res.json(locations.map(loc => ({
    ...loc,
    coords: [loc.lat, loc.lng],
    unlockedByDefault: !!loc.unlocked_by_default,
    unlockedBy: unlockMap[loc.id] || [],
    era: loc.era ?? null,
    eraLabel: loc.era_label ?? null,
  })));
});

// GET /api/locations/:id/characters
router.get('/locations/:id/characters', (req, res) => {
  const db = getDb();
  const characters = db.prepare(
    'SELECT id, name, anonymous_name, role, location_id, portrait_mood FROM characters WHERE location_id = ?'
  ).all(req.params.id);

  const clueRows = db.prepare(`
    SELECT cc.character_id, cc.clue_id FROM character_clues cc
    JOIN characters c ON c.id = cc.character_id
    WHERE c.location_id = ?
  `).all(req.params.id);

  const clueMap = {};
  for (const row of clueRows) {
    if (!clueMap[row.character_id]) clueMap[row.character_id] = [];
    clueMap[row.character_id].push(row.clue_id);
  }

  res.json(characters.map(char => ({
    ...char,
    clueIds: clueMap[char.id] || [],
  })));
});

// GET /api/characters/:id — character data for chat (spoiler fields stripped)
router.get('/characters/:id', (req, res) => {
  const db = getDb();
  const char = db.prepare(
    'SELECT id, name, anonymous_name, role, location_id, portrait_mood, suggested_questions, opening_line FROM characters WHERE id = ?'
  ).get(req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  const clues = db.prepare(
    'SELECT clue_id FROM character_clues WHERE character_id = ?'
  ).all(req.params.id);

  let suggestedQuestions = [];
  try {
    suggestedQuestions = JSON.parse(char.suggested_questions || '[]');
    if (!Array.isArray(suggestedQuestions)) suggestedQuestions = [];
  } catch {
    suggestedQuestions = [];
  }

  res.json({
    id: char.id,
    name: char.name,
    anonymous_name: char.anonymous_name,
    role: char.role,
    location_id: char.location_id,
    portrait_mood: char.portrait_mood,
    clues: clues.map(c => c.clue_id),
    suggestedQuestions,
    openingLine: char.opening_line || null,
  });
});

// GET /api/clues
router.get('/clues', (req, res) => {
  const db = getDb();
  const clues = db.prepare('SELECT * FROM clues').all();
  const links = db.prepare('SELECT * FROM clue_links').all();

  const linkMap = {};
  for (const link of links) {
    if (!linkMap[link.clue_id]) linkMap[link.clue_id] = [];
    linkMap[link.clue_id].push(link.linked_clue_id);
  }

  res.json(clues.map(clue => ({
    ...clue,
    unlocksLocation: clue.unlocks_location_id,
    linkedClues: linkMap[clue.id] || [],
    finale: !!clue.finale,
  })));
});

// GET /api/clues/:id
router.get('/clues/:id', (req, res) => {
  const db = getDb();
  const clue = db.prepare('SELECT * FROM clues WHERE id = ?').get(req.params.id);
  if (!clue) return res.status(404).json({ error: 'Clue not found' });

  const links = db.prepare('SELECT linked_clue_id FROM clue_links WHERE clue_id = ?').all(req.params.id);

  res.json({
    ...clue,
    unlocksLocation: clue.unlocks_location_id,
    linkedClues: links.map(l => l.linked_clue_id),
    finale: !!clue.finale,
  });
});

// POST /api/verify-key — verify an OpenRouter API key
router.post('/verify-key', async (req, res) => {
  const key = req.body.key;
  if (!key) return res.json({ valid: false });
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { 'Authorization': `Bearer ${key}` },
    });
    res.json({ valid: resp.ok });
  } catch {
    res.json({ valid: false });
  }
});

module.exports = router;
