<?php
/**
 * API Router — all requests go through here via .htaccess
 */
require_once __DIR__ . '/config.php';

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-OpenRouter-Key');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$uri = preg_replace('#^/api#', '', $uri);
$method = $_SERVER['REQUEST_METHOD'];

// Route matching
try {
    // GET /locations
    if ($method === 'GET' && $uri === '/locations') {
        require __DIR__ . '/routes/locations.php';
        getLocations();
    }
    // GET /locations/:id/characters
    elseif ($method === 'GET' && preg_match('#^/locations/([^/]+)/characters$#', $uri, $m)) {
        require __DIR__ . '/routes/locations.php';
        getLocationCharacters($m[1]);
    }
    // GET /characters/:id
    elseif ($method === 'GET' && preg_match('#^/characters/([^/]+)$#', $uri, $m)) {
        require __DIR__ . '/routes/locations.php';
        getCharacter($m[1]);
    }
    // GET /clues
    elseif ($method === 'GET' && $uri === '/clues') {
        require __DIR__ . '/routes/locations.php';
        getClues();
    }
    // GET /clues/:id
    elseif ($method === 'GET' && preg_match('#^/clues/([^/]+)$#', $uri, $m)) {
        require __DIR__ . '/routes/locations.php';
        getClue($m[1]);
    }
    // GET /clue-types
    elseif ($method === 'GET' && $uri === '/clue-types') {
        require __DIR__ . '/routes/locations.php';
        getClueTypes();
    }
    // GET /config
    elseif ($method === 'GET' && $uri === '/config') {
        require __DIR__ . '/routes/locations.php';
        getConfig();
    }
    // POST /chat/message
    elseif ($method === 'POST' && $uri === '/chat/message') {
        require __DIR__ . '/routes/chat.php';
        chatMessage();
    }
    // POST /chat/analyze
    elseif ($method === 'POST' && $uri === '/chat/analyze') {
        require __DIR__ . '/routes/chat.php';
        chatAnalyze();
    }
    // POST /chat/recap
    elseif ($method === 'POST' && $uri === '/chat/recap') {
        require __DIR__ . '/routes/chat.php';
        chatRecap();
    }
    // POST /chat/finale
    elseif ($method === 'POST' && $uri === '/chat/finale') {
        require __DIR__ . '/routes/chat.php';
        chatFinale();
    }
    // POST /chat/summarize
    elseif ($method === 'POST' && $uri === '/chat/summarize') {
        require __DIR__ . '/routes/chat.php';
        chatSummarize();
    }
    // POST /chat/note
    elseif ($method === 'POST' && $uri === '/chat/note') {
        require __DIR__ . '/routes/chat.php';
        chatNote();
    }
    // POST /player
    elseif ($method === 'POST' && $uri === '/player') {
        require __DIR__ . '/routes/player.php';
        createPlayer();
    }
    // GET /player/:id
    elseif ($method === 'GET' && preg_match('#^/player/([^/]+)$#', $uri, $m)) {
        require __DIR__ . '/routes/player.php';
        loadPlayer($m[1]);
    }
    // PUT /player/:id/state
    elseif (($method === 'PUT' || $method === 'POST') && preg_match('#^/player/([^/]+)/state$#', $uri, $m)) {
        require __DIR__ . '/routes/player.php';
        savePlayerState($m[1]);
    }
    // PUT /player/:id/conversation/:characterId
    elseif (($method === 'PUT' || $method === 'POST') && preg_match('#^/player/([^/]+)/conversation/([^/]+)$#', $uri, $m)) {
        require __DIR__ . '/routes/player.php';
        saveConversation($m[1], $m[2]);
    }
    // GET /player/:id/board
    elseif ($method === 'GET' && preg_match('#^/player/([^/]+)/board$#', $uri, $m)) {
        require __DIR__ . '/routes/player.php';
        loadBoard($m[1]);
    }
    // PUT /player/:id/board
    elseif (($method === 'PUT' || $method === 'POST') && preg_match('#^/player/([^/]+)/board$#', $uri, $m)) {
        require __DIR__ . '/routes/player.php';
        saveBoard($m[1]);
    }
    // GET /player/:id/notebook
    elseif ($method === 'GET' && preg_match('#^/player/([^/]+)/notebook$#', $uri, $m)) {
        require __DIR__ . '/routes/player.php';
        loadNotebook($m[1]);
    }
    // PUT /player/:id/notebook
    elseif (($method === 'PUT' || $method === 'POST') && preg_match('#^/player/([^/]+)/notebook$#', $uri, $m)) {
        require __DIR__ . '/routes/player.php';
        saveNotebook($m[1]);
    }
    // POST /verify-key
    elseif ($method === 'POST' && $uri === '/verify-key') {
        $input = jsonInput();
        $key = $input['key'] ?? '';
        if (!$key) { jsonResponse(['valid' => false]); }
        $ch = curl_init('https://openrouter.ai/api/v1/auth/key');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $key],
            CURLOPT_TIMEOUT => 10,
        ]);
        curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        jsonResponse(['valid' => $code === 200]);
    }
    else {
        jsonResponse(['error' => 'Not found'], 404);
    }
} catch (Exception $e) {
    error_log("API Error: " . $e->getMessage());
    jsonResponse(['error' => 'Internal server error'], 500);
}
