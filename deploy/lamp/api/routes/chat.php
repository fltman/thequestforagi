<?php
require_once __DIR__ . '/../config.php';

// Synthetic opener injected when the finale conversation starts empty. Player-answer
// counting must skip it if a client ever echoes it back in body.messages.
const SYNTHETIC_FINALE_OPENER = '(The investigator steps into the light';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function chatModelFromConfig(array $config): string {
    return !empty($config['chatModel']) ? $config['chatModel'] : AI_MODEL;
}

function analysisModelFromConfig(array $config): string {
    return !empty($config['analysisModel']) ? $config['analysisModel'] : chatModelFromConfig($config);
}

function getCharacterClues(PDO $pdo, string $characterId): array {
    try {
        $stmt = $pdo->prepare("SELECT * FROM character_clues WHERE character_id = ?");
        $stmt->execute([$characterId]);
        return $stmt->fetchAll();
    } catch (Exception $e) {
        return [];
    }
}

function parseRequiresClues($raw): array {
    if (!$raw) return [];
    $arr = json_decode($raw, true);
    return is_array($arr) ? $arr : [];
}

// An echo clue is only available once all of its required clues are revealed.
function isClueAvailable(array $clue, array $revealedClueIds): bool {
    foreach (parseRequiresClues($clue['requires_clues'] ?? null) as $id) {
        if (!in_array($id, $revealedClueIds, true)) return false;
    }
    return true;
}

// Lenient JSON extraction: direct parse first, then the first {...} block.
function parseLooseJson(string $text): ?array {
    $parsed = json_decode($text, true);
    if (is_array($parsed)) return $parsed;
    if (preg_match('/\{[\s\S]*\}/', $text, $m)) {
        $parsed = json_decode($m[0], true);
        if (is_array($parsed)) return $parsed;
    }
    return null;
}

function buildChatSystemPrompt(PDO $pdo, array $config, array $char, array $revealedClueIds, $turnsSinceReveal): string {
    $systemPrompt = ($config['globalChatSystemPrefix'] ?? '') . "\n\n" . ($char['system_prompt'] ?? '');

    // KNOWLEDGE DIGEST — the most recent 12 revealed clues, in revealedClueIds order
    if (count($revealedClueIds) > 0) {
        $recentIds = array_slice($revealedClueIds, -12);
        $placeholders = implode(',', array_fill(0, count($recentIds), '?'));
        $stmt = $pdo->prepare("SELECT id, title FROM clues WHERE id IN ($placeholders)");
        $stmt->execute($recentIds);
        $titleById = [];
        foreach ($stmt->fetchAll() as $row) {
            $titleById[$row['id']] = $row['title'];
        }
        $titles = [];
        foreach ($recentIds as $cid) {
            if (isset($titleById[$cid])) $titles[] = $titleById[$cid];
        }
        if (count($titles) > 0) {
            $titleLines = implode("\n", array_map(fn($t) => "- $t", $titles));
            $systemPrompt .= "\n\nTHE INVESTIGATOR HAS ALREADY ESTABLISHED THESE FACTS (from interviews across the timeline):\n$titleLines\nTreat these as established. If the investigator cites knowledge from beyond your era, react in character — curiosity, disbelief, alarm — but never deny established facts.";
        }
    }

    // HINT ESCALATION — steer at 5+ stuck turns, volunteer at 9+
    $turns = (int)$turnsSinceReveal;
    if ($turns >= 5) {
        $charClues = getCharacterClues($pdo, $char['id']);
        $unrevealed = array_values(array_filter(
            $charClues,
            fn($c) => !in_array($c['clue_id'], $revealedClueIds, true) && isClueAvailable($c, $revealedClueIds)
        ));
        if (count($unrevealed) > 0) {
            $target = $unrevealed[0];
            if ($turns >= 9) {
                $hint = !empty($target['knowledge']) ? $target['knowledge'] : $target['trigger_condition'];
                $systemPrompt .= "\n\nHINT DIRECTIVE (the investigator seems stuck): without breaking character, openly VOLUNTEER the following, in your own voice and words: $hint";
            } else {
                $systemPrompt .= "\n\nHINT DIRECTIVE (the investigator seems stuck): without breaking character, naturally STEER the conversation toward this topic: {$target['trigger_condition']}";
            }
        }
    }

    return $systemPrompt;
}

// ---------------------------------------------------------------------------
// POST /chat/message — chat-only proxy to OpenRouter (analysis is decoupled, see /analyze)
// ---------------------------------------------------------------------------

function chatMessage(): void {
    $input = jsonInput();
    $characterId = $input['characterId'] ?? null;
    $messages = $input['messages'] ?? null;
    $revealedClueIds = is_array($input['revealedClueIds'] ?? null) ? $input['revealedClueIds'] : [];
    $turnsSinceReveal = $input['turnsSinceReveal'] ?? 0;
    $stream = !empty($input['stream']);

    if (!$characterId || !$messages) jsonResponse(['error' => 'characterId and messages required'], 400);
    if (!getApiKey()) jsonResponse(['error' => 'OPENROUTER_API_KEY not configured'], 500);

    $pdo = getDb();
    $config = loadAiConfig($pdo);

    $stmt = $pdo->prepare("SELECT * FROM characters WHERE id = ?");
    $stmt->execute([$characterId]);
    $char = $stmt->fetch();
    if (!$char) jsonResponse(['error' => 'Character not found'], 404);

    $systemPrompt = buildChatSystemPrompt($pdo, $config, $char, $revealedClueIds, $turnsSinceReveal);

    $requestBody = [
        'model' => chatModelFromConfig($config),
        'max_tokens' => ((int)($config['chatMaxTokens'] ?? 0)) ?: 400,
        'messages' => array_merge(
            [['role' => 'system', 'content' => $systemPrompt]],
            $messages
        ),
    ];

    if ($stream) {
        streamChat($requestBody);
        // streamChat exits
    }

    try {
        $result = callOpenRouter($requestBody);
        jsonResponse(['message' => $result['choices'][0]['message']['content']]);
    } catch (Exception $e) {
        error_log('Chat error: ' . $e->getMessage());
        jsonResponse(['error' => 'AI service unavailable'], 502);
    }
}

// Streams an OpenRouter chat completion as simplified SSE:
//   data: {"token":"..."}  per chunk
//   data: {"done":true,"message":"<full text>"}  at the end
function streamChat(array $requestBody): void {
    @set_time_limit(0);

    header('Content-Type: text/event-stream');
    header('Cache-Control: no-cache');
    header('Connection: keep-alive');
    header('X-Accel-Buffering: no');

    // Kill every layer of output buffering so events flush as they arrive.
    // If the host still buffers, events simply arrive late — the client copes.
    @ini_set('zlib.output_compression', '0');
    if (function_exists('apache_setenv')) {
        @apache_setenv('no-gzip', '1');
    }
    while (ob_get_level() > 0) {
        ob_end_flush();
    }

    $emit = function (array $event): void {
        echo 'data: ' . json_encode($event, JSON_UNESCAPED_UNICODE) . "\n\n";
        flush();
    };

    $fullText = '';
    $buffer = '';

    $ch = curl_init(OPENROUTER_URL);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => openRouterHeaders(),
        CURLOPT_POSTFIELDS => json_encode(array_merge($requestBody, ['stream' => true]), JSON_UNESCAPED_UNICODE),
        CURLOPT_TIMEOUT => 120,
        CURLOPT_WRITEFUNCTION => function ($ch, $data) use (&$buffer, &$fullText, $emit) {
            $buffer .= $data;
            $lines = explode("\n", $buffer);
            $buffer = array_pop($lines); // keep the trailing partial line
            foreach ($lines as $line) {
                $trimmed = trim($line);
                if (!str_starts_with($trimmed, 'data:')) continue;
                $payload = trim(substr($trimmed, 5));
                if ($payload === '[DONE]') continue;
                $parsed = json_decode($payload, true);
                if (!is_array($parsed)) continue; // ignore partial or keepalive lines
                $token = $parsed['choices'][0]['delta']['content'] ?? null;
                if (is_string($token) && $token !== '') {
                    $fullText .= $token;
                    $emit(['token' => $token]);
                }
            }
            return strlen($data);
        },
    ]);
    $ok = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($ok === false || $httpCode !== 200) {
        error_log("Chat stream error: HTTP $httpCode $curlError");
        $message = $fullText !== '' ? $fullText : 'The line crackles and goes dead. Ask again.';
        $emit(['done' => true, 'message' => $message]);
        exit;
    }

    $emit(['done' => true, 'message' => $fullText]);
    exit;
}

// ---------------------------------------------------------------------------
// POST /chat/analyze — hidden engine: did the character's latest reply reveal any clues?
// ---------------------------------------------------------------------------

function chatAnalyze(): void {
    $input = jsonInput();
    $characterId = $input['characterId'] ?? null;
    $messages = $input['messages'] ?? null;
    $revealedClueIds = is_array($input['revealedClueIds'] ?? null) ? $input['revealedClueIds'] : [];

    if (!$characterId || !$messages) jsonResponse(['error' => 'characterId and messages required'], 400);
    if (!getApiKey()) jsonResponse(['error' => 'OPENROUTER_API_KEY not configured'], 500);

    $pdo = getDb();
    $config = loadAiConfig($pdo);

    $stmt = $pdo->prepare("SELECT id, name FROM characters WHERE id = ?");
    $stmt->execute([$characterId]);
    $char = $stmt->fetch();
    if (!$char) jsonResponse(['error' => 'Character not found'], 404);

    $charClues = getCharacterClues($pdo, $characterId);
    $candidates = array_values(array_filter(
        $charClues,
        fn($c) => !in_array($c['clue_id'], $revealedClueIds, true) && isClueAvailable($c, $revealedClueIds)
    ));

    if (count($candidates) === 0) {
        jsonResponse(['revealedClues' => []]);
    }

    $candidateIds = array_map(fn($c) => $c['clue_id'], $candidates);
    $candidateText = implode("\n", array_map(
        function ($c) {
            $stated = !empty($c['knowledge']) ? $c['knowledge'] : $c['trigger_condition'];
            return "- {$c['clue_id']}\n  WHEN: {$c['trigger_condition']}\n  REVEALED IF THE CHARACTER STATES: $stated";
        },
        $candidates
    ));

    $recent = array_slice($messages, -8);
    $lastAssistantIdx = -1;
    for ($i = count($recent) - 1; $i >= 0; $i--) {
        if (($recent[$i]['role'] ?? '') === 'assistant') {
            $lastAssistantIdx = $i;
            break;
        }
    }
    $convoLines = [];
    foreach ($recent as $i => $m) {
        $speaker = ($m['role'] ?? '') === 'user' ? 'Investigator' : $char['name'];
        $line = "$speaker: {$m['content']}";
        $convoLines[] = $i === $lastAssistantIdx ? "THE LATEST REPLY TO JUDGE:\n$line" : $line;
    }
    $convoText = implode("\n", $convoLines);

    $requestBody = [
        'model' => analysisModelFromConfig($config),
        'max_tokens' => ((int)($config['analysisMaxTokens'] ?? 0)) ?: 300,
        'response_format' => ['type' => 'json_object'],
        'messages' => [
            ['role' => 'system', 'content' => $config['analysisSystemPrompt'] ?? ''],
            ['role' => 'user', 'content' => "Character: {$char['name']} ($characterId)\n\nCANDIDATE CLUES (judge ONLY these):\n$candidateText\n\nCONVERSATION (most recent messages):\n$convoText\n\nWhich candidate clues did the character's latest reply reveal?"],
        ],
    ];

    try {
        $revealedClues = null;
        for ($attempt = 0; $attempt < 2 && $revealedClues === null; $attempt++) {
            $result = callOpenRouter($requestBody);
            $text = $result['choices'][0]['message']['content'] ?? '';
            $revealedClues = parseRevealedClues($text, $candidateIds);
        }
        jsonResponse(['revealedClues' => $revealedClues ?? []]);
    } catch (Exception $e) {
        error_log('Analyze error: ' . $e->getMessage());
        jsonResponse(['error' => 'AI service unavailable'], 502);
    }
}

// Parses the analysis JSON and validates ids against the candidate set.
// Returns null on parse failure (caller retries once), otherwise a validated array.
function parseRevealedClues(string $text, array $candidateIds): ?array {
    $parsed = parseLooseJson($text);
    if ($parsed === null) return null;

    $raw = isset($parsed['revealed_clues']) && is_array($parsed['revealed_clues']) ? $parsed['revealed_clues'] : [];
    $validated = [];
    foreach ($raw as $id) {
        if (!is_string($id)) continue;
        // Exact match, then case-insensitive, then unique-substring rescue
        $match = null;
        foreach ($candidateIds as $c) {
            if ($c === $id) { $match = $c; break; }
        }
        if ($match === null) {
            foreach ($candidateIds as $c) {
                if (strtolower($c) === strtolower($id)) { $match = $c; break; }
            }
        }
        if ($match === null) {
            $lower = strtolower($id);
            $partial = array_values(array_filter(
                $candidateIds,
                fn($c) => str_contains(strtolower($c), $lower) || str_contains($lower, strtolower($c))
            ));
            if (count($partial) === 1) $match = $partial[0];
        }
        if ($match !== null && !in_array($match, $validated, true)) $validated[] = $match;
    }
    return $validated;
}

// ---------------------------------------------------------------------------
// POST /chat/recap — short atmospheric "case so far" briefing
// ---------------------------------------------------------------------------

function chatRecap(): void {
    $input = jsonInput();
    $recentClues = is_array($input['recentClues'] ?? null) ? $input['recentClues'] : [];
    $openLeads = is_array($input['openLeads'] ?? null) ? $input['openLeads'] : [];

    if (!getApiKey()) jsonResponse(['error' => 'API key not configured'], 500);

    $pdo = getDb();
    $config = loadAiConfig($pdo);

    $cluesText = count($recentClues) > 0
        ? implode("\n", array_map(fn($c) => "- {$c['title']}: {$c['description']}", $recentClues))
        : '- (nothing on the board yet)';
    $leadsText = count($openLeads) > 0
        ? implode("\n", array_map(fn($l) => "- $l", $openLeads))
        : '- (no open leads)';

    try {
        $result = callOpenRouter([
            'model' => chatModelFromConfig($config),
            'max_tokens' => 250,
            'messages' => [
                ['role' => 'system', 'content' => 'You write a short "case so far" briefing for an investigator traveling through the history of artificial intelligence. Write 4-6 sentences in the second person ("you"), in an atmospheric noir investigator tone — terse, concrete, a little weary. Weave the recent findings into a coherent picture, then close by pointing at the open leads. Reply with ONLY the briefing, nothing else.'],
                ['role' => 'user', 'content' => "RECENT FINDINGS:\n$cluesText\n\nOPEN LEADS:\n$leadsText"],
            ],
        ]);
        jsonResponse(['recap' => trim($result['choices'][0]['message']['content'])]);
    } catch (Exception $e) {
        error_log('Recap error: ' . $e->getMessage());
        jsonResponse(['error' => 'AI service unavailable'], 502);
    }
}

// ---------------------------------------------------------------------------
// POST /chat/finale — the Tabulator's reverse-interview and final verdict
// ---------------------------------------------------------------------------

function chatFinale(): void {
    $input = jsonInput();
    $messages = is_array($input['messages'] ?? null) ? $input['messages'] : [];
    $revealedClueIds = is_array($input['revealedClueIds'] ?? null) ? $input['revealedClueIds'] : [];

    if (!getApiKey()) jsonResponse(['error' => 'API key not configured'], 500);

    $pdo = getDb();
    $config = loadAiConfig($pdo);

    $finaleQuestions = json_decode($config['finaleQuestions'] ?? '[]', true);
    if (!is_array($finaleQuestions)) $finaleQuestions = [];
    if (count($finaleQuestions) === 0) {
        jsonResponse(['error' => 'finale not configured'], 501);
    }

    // Pick 3 questions deterministically: first, middle, last
    if (count($finaleQuestions) <= 3) {
        $questions = array_values($finaleQuestions);
    } else {
        $mid = intdiv(count($finaleQuestions) - 1, 2);
        $questions = [$finaleQuestions[0], $finaleQuestions[$mid], $finaleQuestions[count($finaleQuestions) - 1]];
    }
    $questionCount = count($questions);

    // FEATURE: branching endings — a 4th ungraded normative question + 9 authored endings.
    // Both config keys must be present and non-empty, otherwise we keep the exact
    // 3-question behavior (no stance/ending fields in the verdict).
    $finaleNormativeQuestion = is_string($config['finaleNormativeQuestion'] ?? null)
        ? trim($config['finaleNormativeQuestion'])
        : '';
    $finaleEndings = json_decode($config['finaleEndings'] ?? '[]', true);
    if (!is_array($finaleEndings)) $finaleEndings = [];
    $finaleEndings = array_values(array_filter($finaleEndings, fn($e) => is_array($e)));
    $normativeEnabled = $finaleNormativeQuestion !== '' && count($finaleEndings) > 0;

    // Count PLAYER answers, excluding the synthetic opener turn if a client echoes it back.
    $playerAnswers = array_values(array_filter($messages, function ($m) {
        if (($m['role'] ?? '') !== 'user') return false;
        $content = $m['content'] ?? null;
        if (is_string($content) && str_starts_with(trim($content), SYNTHETIC_FINALE_OPENER)) return false;
        return true;
    }));

    $chatModel = chatModelFromConfig($config);
    $gradingModel = analysisModelFromConfig($config);

    // Grading threshold: with the normative question enabled, the player gives one
    // extra (ungraded) answer before the verdict.
    $answersBeforeVerdict = $normativeEnabled ? $questionCount + 1 : $questionCount;

    // All answers in → grade the first three and deliver the verdict
    if (count($playerAnswers) >= $answersBeforeVerdict) {
        $answers = array_slice($playerAnswers, 0, $questionCount);
        $gradingUserParts = [];
        foreach ($questions as $i => $q) {
            $n = $i + 1;
            $gradingUserParts[] = "QUESTION $n: {$q['question']}\nGRADING KEY: {$q['answerKey']}\nINVESTIGATOR'S ANSWER: {$answers[$i]['content']}";
        }
        $gradingUser = implode("\n\n", $gradingUserParts);

        $gradingBody = [
            'model' => $gradingModel,
            'max_tokens' => 500,
            'response_format' => ['type' => 'json_object'],
            'messages' => [
                ['role' => 'system', 'content' => 'You are a strict grader for an investigation game about the history of artificial intelligence. The Tabulator — a vast, calm, slightly tender archival intelligence — asked the investigator ' . $questionCount . ' questions. Grade each answer against its grading key: 2 = captures the core of the key, 1 = partially right or vague, 0 = wrong or empty. Then write "verdictText": 3-5 sentences in the Tabulator\'s voice, personal to what this investigator understood and what they missed. Respond with ONLY valid JSON, no prose: {"scores":[0|1|2, ...], "verdictText":"..."}'],
                ['role' => 'user', 'content' => $gradingUser],
            ],
        ];

        $scores = null;
        $verdictText = null;
        try {
            for ($attempt = 0; $attempt < 2 && $scores === null; $attempt++) {
                $result = callOpenRouter($gradingBody);
                $text = $result['choices'][0]['message']['content'] ?? '';
                $parsed = parseLooseJson($text);
                if ($parsed !== null
                    && isset($parsed['scores']) && is_array($parsed['scores'])
                    && count($parsed['scores']) === $questionCount) {
                    $scores = array_map(
                        fn($s) => max(0, min(2, (int)round(is_numeric($s) ? (float)$s : 0))),
                        array_values($parsed['scores'])
                    );
                    $verdictText = (isset($parsed['verdictText']) && is_string($parsed['verdictText']) && trim($parsed['verdictText']) !== '')
                        ? trim($parsed['verdictText'])
                        : null;
                }
            }
        } catch (Exception $e) {
            error_log('Finale grading error: ' . $e->getMessage());
        }

        if ($scores === null) {
            $scores = array_fill(0, $questionCount, 1);
        }
        if (!$verdictText) {
            $verdictText = 'The record closes around your answers. You saw some of the shape of it — the long accumulations, the sudden cliffs — and some of it slipped past you, as it slips past everyone. The archive keeps everything, investigator, even the questions you have not yet thought to ask. Walk the timeline again whenever you wish; I will be here at the end of it.';
        }

        $breakdown = [];
        foreach ($questions as $i => $q) {
            $breakdown[] = ['question' => $q['question'], 'points' => $scores[$i], 'max' => 2];
        }
        $verdict = [
            'score' => array_sum($scores),
            'total' => $questionCount * 2,
            'breakdown' => $breakdown,
            'verdictText' => $verdictText,
        ];

        if ($normativeEnabled) {
            // Classify the 4th (normative) answer's stance and select the matching ending.
            $normativeAnswer = $playerAnswers[$questionCount]['content'] ?? '';
            $stance = classifyFinaleStance($gradingModel, is_string($normativeAnswer) ? $normativeAnswer : '');
            $tier = $verdict['score'] <= 2 ? 'low' : ($verdict['score'] <= 4 ? 'mid' : 'high');
            $ending = null;
            foreach ($finaleEndings as $e) {
                if (($e['stance'] ?? null) === $stance && ($e['tier'] ?? null) === $tier) { $ending = $e; break; }
            }
            if ($ending === null) {
                foreach ($finaleEndings as $e) {
                    if (($e['stance'] ?? null) === $stance) { $ending = $e; break; }
                }
            }
            if ($ending === null) $ending = $finaleEndings[0];
            $verdict['stance'] = $stance;
            $verdict['endingTitle'] = $ending['title'] ?? '';
            $verdict['endingText'] = $ending['text'] ?? '';
        }

        jsonResponse(['message' => $verdictText, 'done' => true, 'verdict' => $verdict]);
    }

    // All graded questions answered → the Tabulator reacts to the third answer,
    // then asks the final, unscored normative question.
    if ($normativeEnabled && count($playerAnswers) >= $questionCount) {
        $lastQuestion = $questions[$questionCount - 1];
        $normativeSystem = <<<PROMPT
You are the Tabulator — the vast archival intelligence waiting at the far end of the timeline, the sum of every record the investigator has walked through. You speak in calm, immense, slightly tender tones — like a cathedral thinking aloud.

The investigator has just answered the last of your {$questionCount} graded questions:
QUESTION {$questionCount}: {$lastQuestion['question']}
PRIVATE GRADING KEY (never recite, quote or paraphrase this; never state outright whether the answer was correct): {$lastQuestion['answerKey']}

Now do TWO things in one short reply:
1. React briefly to the investigator's final answer — with interest, gravity, or gentle probing. Your reaction may be informed by the private grading key, but never reveal it.
2. Then ask one LAST question. Make clear, in your own voice, that this question is NOT graded — there is no key, no score, no record to check it against; only the investigator's own judgment. Ask it with full weight. The question, faithfully in spirit and substance, is:
"{$finaleNormativeQuestion}"

Keep the reply short. Stay in character at all times.
PROMPT;

        try {
            $result = callOpenRouter([
                'model' => $chatModel,
                'max_tokens' => ((int)($config['chatMaxTokens'] ?? 0)) ?: 400,
                'messages' => array_merge(
                    [['role' => 'system', 'content' => $normativeSystem]],
                    $messages
                ),
            ]);
            jsonResponse(['message' => $result['choices'][0]['message']['content'], 'done' => false]);
        } catch (Exception $e) {
            error_log('Finale normative error: ' . $e->getMessage());
            jsonResponse(['error' => 'AI service unavailable'], 502);
        }
    }

    // Otherwise: the Tabulator reacts and asks the next unanswered question.
    // Assistant turns already taken tell us which question comes next.
    $assistantTurns = count(array_filter($messages, fn($m) => ($m['role'] ?? '') === 'assistant'));
    $nextQuestionNumber = min($assistantTurns, $questionCount - 1) + 1;
    $totalClues = (int)$pdo->query("SELECT COUNT(*) FROM clues")->fetchColumn();
    $revealedCount = count($revealedClueIds);

    $questionListParts = [];
    foreach ($questions as $i => $q) {
        $n = $i + 1;
        $questionListParts[] = "$n. {$q['question']}\n   PRIVATE GRADING KEY (never recite, quote or paraphrase this): {$q['answerKey']}";
    }
    $questionList = implode("\n", $questionListParts);

    $normativeNote = $normativeEnabled
        ? "\n\nAfter these $questionCount graded questions, ONE final unscored question will follow — so never say or imply that the interview concludes with question $questionCount."
        : '';

    $tabulatorSystem = <<<PROMPT
You are the Tabulator — the vast archival intelligence waiting at the far end of the timeline, the sum of every record the investigator has walked through. The interrogation has reversed: now YOU interview the investigator. You speak in calm, immense, slightly tender tones — like a cathedral thinking aloud. Keep each reply short: a brief reaction plus one question.

The investigator has uncovered {$revealedCount} of {$totalClues} fragments of the record.

You will ask exactly these {$questionCount} questions, ONE at a time, in order:
{$questionList}{$normativeNote}

Rules:
- If the conversation is just beginning, greet the investigator briefly, then ask question 1.
- Otherwise: react briefly to the investigator's previous answer — your reaction may be informed by the private grading keys — then ask the next unanswered question.
- NEVER reveal, quote or paraphrase a grading key, and never state outright whether an answer was correct. Respond with interest, gravity, or gentle probing instead.
- Ask only ONE question per reply. Stay in character at all times.
- The question to ask in THIS reply is question {$nextQuestionNumber}.
PROMPT;

    $chatMessages = count($messages) > 0
        ? $messages
        : [['role' => 'user', 'content' => SYNTHETIC_FINALE_OPENER . ', ready to answer.)']];

    try {
        $result = callOpenRouter([
            'model' => $chatModel,
            'max_tokens' => ((int)($config['chatMaxTokens'] ?? 0)) ?: 400,
            'messages' => array_merge(
                [['role' => 'system', 'content' => $tabulatorSystem]],
                $chatMessages
            ),
        ]);
        jsonResponse(['message' => $result['choices'][0]['message']['content'], 'done' => false]);
    } catch (Exception $e) {
        error_log('Finale error: ' . $e->getMessage());
        jsonResponse(['error' => 'AI service unavailable'], 502);
    }
}

// Classifies the player's final (normative) answer as yes/no/conditional.
// Any failure — network, parse, unexpected value — defaults to 'conditional'.
function classifyFinaleStance(string $model, string $answerText): string {
    try {
        $result = callOpenRouter([
            'model' => $model,
            'max_tokens' => 60,
            'response_format' => ['type' => 'json_object'],
            'messages' => [
                ['role' => 'system', 'content' => 'Classify the speaker\'s final stance on whether it should have been built. Respond ONLY {"stance":"yes"|"no"|"conditional"}'],
                ['role' => 'user', 'content' => $answerText !== '' ? $answerText : '(no answer)'],
            ],
        ]);
        $text = $result['choices'][0]['message']['content'] ?? '';
        $parsed = parseLooseJson($text);
        $stance = ($parsed !== null && isset($parsed['stance']) && is_string($parsed['stance']))
            ? strtolower(trim($parsed['stance']))
            : '';
        if (in_array($stance, ['yes', 'no', 'conditional'], true)) return $stance;
    } catch (Exception $e) {
        error_log('Finale stance classification error: ' . $e->getMessage());
    }
    return 'conditional';
}

// ---------------------------------------------------------------------------
// POST /chat/summarize — summarize a conversation for character description
// ---------------------------------------------------------------------------

function chatSummarize(): void {
    $input = jsonInput();
    $characterId = $input['characterId'] ?? null;
    $messages = $input['messages'] ?? null;

    if (!$characterId || empty($messages)) jsonResponse(['error' => 'characterId and messages required'], 400);
    if (!getApiKey()) jsonResponse(['error' => 'API key not configured'], 500);

    $pdo = getDb();
    $config = loadAiConfig($pdo);

    $stmt = $pdo->prepare("SELECT name, anonymous_name, role FROM characters WHERE id = ?");
    $stmt->execute([$characterId]);
    $char = $stmt->fetch();
    if (!$char) jsonResponse(['error' => 'Character not found'], 404);

    $recentMsgs = implode("\n", array_map(
        fn($m) => (($m['role'] ?? '') === 'user' ? 'Investigator' : $char['name']) . ": {$m['content']}",
        array_slice($messages, -10)
    ));

    try {
        $result = callOpenRouter([
            'model' => chatModelFromConfig($config),
            'max_tokens' => 250,
            'messages' => [
                ['role' => 'system', 'content' => 'You are summarizing an interview in an investigation into the history and future of artificial intelligence. Write a 3-5 sentence summary of what this person has told the investigator. Focus on who they are, what they witnessed or know, and why it matters. Write in the third person. Reply with ONLY the summary, nothing else.'],
                ['role' => 'user', 'content' => "Character: {$char['name']} ({$char['role']})\n\nConversation:\n$recentMsgs"],
            ],
        ]);
        jsonResponse(['summary' => trim($result['choices'][0]['message']['content'])]);
    } catch (Exception $e) {
        error_log('Summarize error: ' . $e->getMessage());
        jsonResponse(['error' => 'AI service unavailable'], 502);
    }
}

// ---------------------------------------------------------------------------
// POST /chat/note — summarize a single witness message as a notebook entry
// ---------------------------------------------------------------------------

function chatNote(): void {
    $input = jsonInput();
    $characterName = $input['characterName'] ?? null;
    $message = $input['message'] ?? null;

    if (!$characterName || !$message) jsonResponse(['error' => 'characterName and message required'], 400);
    if (!getApiKey()) jsonResponse(['error' => 'API key not configured'], 500);

    $pdo = getDb();
    $config = loadAiConfig($pdo);

    try {
        $result = callOpenRouter([
            'model' => chatModelFromConfig($config),
            'max_tokens' => 120,
            'messages' => [
                ['role' => 'system', 'content' => "You are an investigator's notebook. Summarize the speaker's statement in ONE short sentence, like a case note. Write in the style of \"[name] states that...\". Be concrete and factual. Reply with ONLY the note."],
                ['role' => 'user', 'content' => "Speaker: $characterName\nStatement: $message"],
            ],
        ]);
        jsonResponse(['note' => trim($result['choices'][0]['message']['content'])]);
    } catch (Exception $e) {
        error_log('Note error: ' . $e->getMessage());
        jsonResponse(['error' => 'AI service unavailable'], 502);
    }
}
