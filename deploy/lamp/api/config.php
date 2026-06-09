<?php
/**
 * Configuration — edit these values for your server
 */

define('DB_HOST', getenv('DB_HOST') ?: 'localhost');
define('DB_NAME', getenv('DB_NAME') ?: 'agi_game');
define('DB_USER', getenv('DB_USER') ?: 'root');   // MAMP default: root / root. Set to your one.com DB user.
define('DB_PASS', getenv('DB_PASS') ?: 'root');   // MAMP default: root. Set to your one.com DB password.
define('DB_PORT', getenv('DB_PORT') ?: '3306');   // MAMP's MySQL usually runs on 8889 — set this to 8889 for MAMP.
// Server-side OpenRouter key is intentionally EMPTY: each player enters their own key in the UI,
// which is stored in their browser's localStorage and sent per-request as the X-OpenRouter-Key header.
// Only set this if you want one shared key for everyone.
define('OPENROUTER_API_KEY', getenv('OPENROUTER_API_KEY') ?: '');
// Fallback model only — the actual models come from the ai_config table
// (chatModel for conversation, analysisModel for the hidden clue engine / grading).
define('AI_MODEL', 'anthropic/claude-haiku-4.5');
define('OPENROUTER_URL', 'https://openrouter.ai/api/v1/chat/completions');

function getDb(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = "mysql:host=" . DB_HOST . ";port=" . DB_PORT . ";dbname=" . DB_NAME . ";charset=utf8mb4";
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            // Native prepares so mysqlnd returns ints/floats as native types (mirrors the Node/SQLite API)
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    }
    return $pdo;
}

function loadAiConfig(PDO $pdo): array {
    $config = [];
    foreach ($pdo->query("SELECT `key`, value FROM ai_config")->fetchAll() as $r) {
        $config[$r['key']] = $r['value'];
    }
    return $config;
}

function jsonResponse($data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function jsonInput(): array {
    return json_decode(file_get_contents('php://input'), true) ?? [];
}

function getApiKey(): string {
    return $_SERVER['HTTP_X_OPENROUTER_KEY'] ?? OPENROUTER_API_KEY;
}

function openRouterHeaders(?string $apiKey = null): array {
    $key = $apiKey ?? getApiKey();
    return [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $key,
        'HTTP-Referer: https://the-quest-for-agi.local',
        'X-Title: The Quest for AGI',
    ];
}

function callOpenRouter(array $body, ?string $apiKey = null): array {
    $ch = curl_init(OPENROUTER_URL);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => openRouterHeaders($apiKey),
        CURLOPT_POSTFIELDS => json_encode($body, JSON_UNESCAPED_UNICODE),
        CURLOPT_TIMEOUT => 60,
    ]);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200) {
        throw new Exception("OpenRouter error: $httpCode — $response");
    }
    return json_decode($response, true);
}
