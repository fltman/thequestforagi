#!/usr/bin/env php
<?php
/**
 * Seeds the MySQL database from agi_game_data.json (mirrors server/db/seed.js)
 * Usage: php seed.php
 */

require_once __DIR__ . '/../api/config.php';

$candidates = [
    __DIR__ . '/../../../data/agi_game_data.json',  // repo /data (running from deploy/lamp/sql)
    __DIR__ . '/../../data/agi_game_data.json',      // deploy/lamp/data
    __DIR__ . '/../public/data/agi_game_data.json',  // built public/data
    __DIR__ . '/../data/agi_game_data.json',
];
$dataFile = null;
foreach ($candidates as $c) { if (file_exists($c)) { $dataFile = $c; break; } }
if (!$dataFile) die("Error: agi_game_data.json not found\n");

$data = json_decode(file_get_contents($dataFile), true);
if (!$data) die("Error: Could not parse JSON\n");

$pdo = getDb();

// Schema upgrades, in case the tables were created from an older schema.sql.
// Each statement is a no-op (caught) when the column already matches.
$alters = [
    "ALTER TABLE characters MODIFY portrait_mood TEXT",
    "ALTER TABLE locations ADD COLUMN era INT NULL",
    "ALTER TABLE locations ADD COLUMN era_label TEXT NULL",
    "ALTER TABLE characters ADD COLUMN suggested_questions TEXT NULL",
    "ALTER TABLE characters ADD COLUMN opening_line TEXT NULL",
    "ALTER TABLE clues ADD COLUMN finale TINYINT(1) NOT NULL DEFAULT 0",
    "ALTER TABLE character_clues ADD COLUMN requires_clues TEXT NULL",
    "ALTER TABLE player_state ADD COLUMN visited_locations TEXT NOT NULL",
];
foreach ($alters as $sql) {
    try { $pdo->exec($sql); } catch (Exception $e) {}
}

// Truncate in reverse dependency order (including player data)
$pdo->exec("SET FOREIGN_KEY_CHECKS = 0");
$tables = ['player_conversations', 'player_notebook', 'player_board', 'player_state', 'players',
           'character_clues', 'clue_links', 'location_unlock_clues', 'characters', 'clues', 'locations', 'clue_types', 'ai_config'];
foreach ($tables as $t) {
    $pdo->exec("TRUNCATE TABLE $t");
}
$pdo->exec("SET FOREIGN_KEY_CHECKS = 1");

// Seed ai_config — generic loop: strings stored as-is, everything else JSON-encoded
$stmt = $pdo->prepare("INSERT INTO ai_config (`key`, value) VALUES (?, ?)");
foreach (($data['aiConfig'] ?? []) as $key => $value) {
    $stmt->execute([$key, is_string($value) ? $value : json_encode($value, JSON_UNESCAPED_UNICODE)]);
}
if (!empty($data['meta'])) {
    if (isset($data['meta']['title'])) $stmt->execute(['meta_title', (string)$data['meta']['title']]);
    if (isset($data['meta']['subtitle'])) $stmt->execute(['meta_subtitle', (string)$data['meta']['subtitle']]);
    if (isset($data['meta']['language'])) $stmt->execute(['meta_language', (string)$data['meta']['language']]);
}

// Seed clue_types
$stmt = $pdo->prepare("INSERT INTO clue_types (id, label, color, icon) VALUES (?, ?, ?, ?)");
foreach ($data['clueTypes'] as $id => $ct) {
    $stmt->execute([$id, $ct['label'], $ct['color'], $ct['icon']]);
}

// Seed locations
$stmt = $pdo->prepare("INSERT INTO locations (id, name, description, lat, lng, type, unlocked_by_default, era, era_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
foreach ($data['locations'] as $id => $loc) {
    $stmt->execute([
        $id, $loc['name'], $loc['description'], $loc['coords'][0], $loc['coords'][1], $loc['type'],
        !empty($loc['unlocked']) ? 1 : 0,
        $loc['era'] ?? null,
        $loc['eraLabel'] ?? null,
    ]);
}

// Seed clues
$stmt = $pdo->prepare("INSERT INTO clues (id, title, description, type, unlocks_location_id, finale) VALUES (?, ?, ?, ?, ?, ?)");
foreach ($data['clues'] as $id => $clue) {
    $stmt->execute([
        $id, $clue['title'], $clue['description'], $clue['type'],
        $clue['unlocksLocation'] ?? null,
        !empty($clue['finale']) ? 1 : 0,
    ]);
}

// Seed clue_links
$stmt = $pdo->prepare("INSERT INTO clue_links (clue_id, linked_clue_id) VALUES (?, ?)");
foreach ($data['clues'] as $id => $clue) {
    foreach ($clue['linkedClues'] ?? [] as $linked) {
        $stmt->execute([$id, $linked]);
    }
}

// Seed location_unlock_clues
$stmt = $pdo->prepare("INSERT INTO location_unlock_clues (location_id, clue_id) VALUES (?, ?)");
foreach ($data['locations'] as $id => $loc) {
    foreach ($loc['unlockedBy'] ?? [] as $clueId) {
        $stmt->execute([$id, $clueId]);
    }
}

// Seed characters
$stmtChar = $pdo->prepare("INSERT INTO characters (id, name, anonymous_name, role, location_id, portrait_mood, system_prompt, suggested_questions, opening_line) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
$stmtClue = $pdo->prepare("INSERT INTO character_clues (character_id, clue_id, trigger_condition, knowledge, requires_clues) VALUES (?, ?, ?, ?, ?)");
foreach ($data['characters'] as $id => $char) {
    $stmtChar->execute([
        $id, $char['name'], $char['anonymousName'] ?? 'Unknown', $char['role'], $char['location'],
        $char['portrait_mood'] ?? null, $char['systemPrompt'],
        isset($char['suggestedQuestions']) ? json_encode($char['suggestedQuestions'], JSON_UNESCAPED_UNICODE) : null,
        $char['openingLine'] ?? null,
    ]);
    foreach ($char['clues'] ?? [] as $clueId => $clueData) {
        $stmtClue->execute([
            $id, $clueId, $clueData['triggerCondition'], $clueData['knowledge'] ?? null,
            isset($clueData['requiresClues']) ? json_encode($clueData['requiresClues'], JSON_UNESCAPED_UNICODE) : null,
        ]);
    }
}

echo "Database seeded successfully!\n";
echo "  " . count($data['locations']) . " locations\n";
echo "  " . count($data['characters']) . " characters\n";
echo "  " . count($data['clues']) . " clues\n";
echo "  " . count($data['clueTypes']) . " clue types\n";
