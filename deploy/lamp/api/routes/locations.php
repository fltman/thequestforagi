<?php
require_once __DIR__ . '/../config.php';

function getLocations(): void {
    $pdo = getDb();
    $locations = $pdo->query("SELECT * FROM locations")->fetchAll();

    $unlockClues = $pdo->query("SELECT * FROM location_unlock_clues")->fetchAll();
    $unlockMap = [];
    foreach ($unlockClues as $uc) {
        $unlockMap[$uc['location_id']][] = $uc['clue_id'];
    }

    $result = [];
    foreach ($locations as $loc) {
        $loc['lat'] = (float)$loc['lat'];
        $loc['lng'] = (float)$loc['lng'];
        $loc['unlocked_by_default'] = (int)$loc['unlocked_by_default'];
        $loc['coords'] = [$loc['lat'], $loc['lng']];
        $loc['unlockedByDefault'] = (bool)$loc['unlocked_by_default'];
        $loc['unlockedBy'] = $unlockMap[$loc['id']] ?? [];
        $loc['era'] = isset($loc['era']) ? (int)$loc['era'] : null;
        $loc['eraLabel'] = $loc['era_label'] ?? null;
        $result[] = $loc;
    }
    jsonResponse($result);
}

function getLocationCharacters(string $locationId): void {
    $pdo = getDb();
    $stmt = $pdo->prepare("SELECT id, name, anonymous_name, role, location_id, portrait_mood FROM characters WHERE location_id = ?");
    $stmt->execute([$locationId]);
    $characters = $stmt->fetchAll();

    $stmt = $pdo->prepare("
        SELECT cc.character_id, cc.clue_id FROM character_clues cc
        JOIN characters c ON c.id = cc.character_id
        WHERE c.location_id = ?
    ");
    $stmt->execute([$locationId]);
    $clueMap = [];
    foreach ($stmt->fetchAll() as $row) {
        $clueMap[$row['character_id']][] = $row['clue_id'];
    }

    $result = [];
    foreach ($characters as $char) {
        $char['clueIds'] = $clueMap[$char['id']] ?? [];
        $result[] = $char;
    }
    jsonResponse($result);
}

// Character data for chat — spoiler fields (system_prompt, trigger conditions,
// knowledge) are deliberately NOT exposed; clues is a plain id array.
function getCharacter(string $characterId): void {
    $pdo = getDb();
    $stmt = $pdo->prepare("SELECT id, name, anonymous_name, role, location_id, portrait_mood, suggested_questions, opening_line FROM characters WHERE id = ?");
    $stmt->execute([$characterId]);
    $char = $stmt->fetch();
    if (!$char) jsonResponse(['error' => 'Character not found'], 404);

    $stmt = $pdo->prepare("SELECT clue_id FROM character_clues WHERE character_id = ?");
    $stmt->execute([$characterId]);
    $clueIds = $stmt->fetchAll(PDO::FETCH_COLUMN);

    $suggestedQuestions = json_decode($char['suggested_questions'] ?? '[]', true);
    if (!is_array($suggestedQuestions)) $suggestedQuestions = [];

    jsonResponse([
        'id' => $char['id'],
        'name' => $char['name'],
        'anonymous_name' => $char['anonymous_name'],
        'role' => $char['role'],
        'location_id' => $char['location_id'],
        'portrait_mood' => $char['portrait_mood'],
        'clues' => $clueIds,
        'suggestedQuestions' => $suggestedQuestions,
        'openingLine' => ($char['opening_line'] ?? '') !== '' ? $char['opening_line'] : null,
    ]);
}

function getClues(): void {
    $pdo = getDb();
    $clues = $pdo->query("SELECT * FROM clues")->fetchAll();

    $links = $pdo->query("SELECT * FROM clue_links")->fetchAll();
    $linkMap = [];
    foreach ($links as $l) {
        $linkMap[$l['clue_id']][] = $l['linked_clue_id'];
    }

    $result = [];
    foreach ($clues as $clue) {
        $clue['unlocksLocation'] = $clue['unlocks_location_id'] ?? null;
        $clue['linkedClues'] = $linkMap[$clue['id']] ?? [];
        $clue['finale'] = (bool)($clue['finale'] ?? 0);
        $result[] = $clue;
    }
    jsonResponse($result);
}

function getClue(string $clueId): void {
    $pdo = getDb();
    $stmt = $pdo->prepare("SELECT * FROM clues WHERE id = ?");
    $stmt->execute([$clueId]);
    $clue = $stmt->fetch();
    if (!$clue) jsonResponse(['error' => 'Clue not found'], 404);

    $stmt = $pdo->prepare("SELECT linked_clue_id FROM clue_links WHERE clue_id = ?");
    $stmt->execute([$clueId]);
    $linked = $stmt->fetchAll(PDO::FETCH_COLUMN);

    $clue['unlocksLocation'] = $clue['unlocks_location_id'] ?? null;
    $clue['linkedClues'] = $linked;
    $clue['finale'] = (bool)($clue['finale'] ?? 0);
    jsonResponse($clue);
}

function getClueTypes(): void {
    $pdo = getDb();
    jsonResponse($pdo->query("SELECT * FROM clue_types")->fetchAll());
}

function getConfig(): void {
    $pdo = getDb();
    $config = loadAiConfig($pdo);
    $config['hasServerKey'] = (bool)OPENROUTER_API_KEY;
    if (isset($config['meta_title'])) $config['metaTitle'] = $config['meta_title'];
    if (isset($config['meta_subtitle'])) $config['metaSubtitle'] = $config['meta_subtitle'];
    if (isset($config['meta_language'])) $config['metaLanguage'] = $config['meta_language'];
    // Never expose the finale material (questions contain the answer keys;
    // the normative question and endings are the game's ending spoilers)
    unset($config['finaleQuestions'], $config['finaleNormativeQuestion'], $config['finaleEndings']);
    $config['charactersTotal'] = (int)$pdo->query("SELECT COUNT(*) FROM characters")->fetchColumn();
    jsonResponse($config);
}
