const express = require('express');
const { getDb } = require('../db/connection');

const router = express.Router();

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5';

function loadConfig(db) {
  const config = {};
  for (const row of db.prepare('SELECT key, value FROM ai_config').all()) {
    config[row.key] = row.value;
  }
  return config;
}

function getApiKey(req) {
  return req.headers['x-openrouter-key'] || process.env.OPENROUTER_API_KEY;
}

// requires_clues is a JSON-array TEXT column that may not exist in older DBs —
// SELECT * and read the property defensively.
function getCharacterClues(db, characterId) {
  try {
    return db.prepare('SELECT * FROM character_clues WHERE character_id = ?').all(characterId);
  } catch {
    return [];
  }
}

function parseRequiresClues(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// An echo clue is only available once all of its required clues are revealed.
function isClueAvailable(clue, revealedClueIds) {
  return parseRequiresClues(clue.requires_clues).every(id => revealedClueIds.includes(id));
}

function buildChatSystemPrompt(db, config, char, revealedClueIds, turnsSinceReveal) {
  let systemPrompt = (config.globalChatSystemPrefix || '') + '\n\n' + (char.system_prompt || '');

  // KNOWLEDGE DIGEST — the most recent 12 revealed clues, in revealedClueIds order
  if (revealedClueIds.length > 0) {
    const recentIds = revealedClueIds.slice(-12);
    const placeholders = recentIds.map(() => '?').join(',');
    const rows = db.prepare(`SELECT id, title FROM clues WHERE id IN (${placeholders})`).all(...recentIds);
    const titleById = new Map(rows.map(r => [r.id, r.title]));
    const titles = recentIds.map(id => titleById.get(id)).filter(Boolean);
    if (titles.length > 0) {
      systemPrompt += `\n\nTHE INVESTIGATOR HAS ALREADY ESTABLISHED THESE FACTS (from interviews across the timeline):\n${titles.map(t => `- ${t}`).join('\n')}\nTreat these as established. If the investigator cites knowledge from beyond your era, react in character — curiosity, disbelief, alarm — but never deny established facts.`;
    }
  }

  // HINT ESCALATION — steer at 5+ stuck turns, volunteer at 9+
  const turns = parseInt(turnsSinceReveal) || 0;
  if (turns >= 5) {
    const charClues = getCharacterClues(db, char.id);
    const unrevealed = charClues.filter(
      c => !revealedClueIds.includes(c.clue_id) && isClueAvailable(c, revealedClueIds)
    );
    if (unrevealed.length > 0) {
      const target = unrevealed[0];
      if (turns >= 9) {
        systemPrompt += `\n\nHINT DIRECTIVE (the investigator seems stuck): without breaking character, openly VOLUNTEER the following, in your own voice and words: ${target.knowledge || target.trigger_condition}`;
      } else {
        systemPrompt += `\n\nHINT DIRECTIVE (the investigator seems stuck): without breaking character, naturally STEER the conversation toward this topic: ${target.trigger_condition}`;
      }
    }
  }

  return systemPrompt;
}

// POST /api/chat/message — chat-only proxy to OpenRouter (analysis is decoupled, see /analyze)
router.post('/message', async (req, res) => {
  const { characterId, messages, revealedClueIds = [], turnsSinceReveal = 0, stream = false } = req.body;

  if (!characterId || !messages) {
    return res.status(400).json({ error: 'characterId and messages required' });
  }

  const apiKey = getApiKey(req);
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });
  }

  const db = getDb();
  const config = loadConfig(db);

  const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  const systemPrompt = buildChatSystemPrompt(db, config, char, revealedClueIds, turnsSinceReveal);

  const requestBody = {
    model: config.chatModel || DEFAULT_MODEL,
    max_tokens: parseInt(config.chatMaxTokens) || 400,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
  };

  if (stream) {
    return streamChat(res, apiKey, requestBody);
  }

  try {
    const result = await callOpenRouter(apiKey, requestBody);
    res.json({ message: result.choices[0].message.content });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(502).json({ error: 'AI service unavailable' });
  }
});

// Streams an OpenRouter chat completion as simplified SSE:
//   data: {"token":"..."}  per chunk
//   data: {"done":true,"message":"<full text>"}  at the end
async function streamChat(res, apiKey, requestBody) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (res.flushHeaders) res.flushHeaders();

  let fullText = '';
  try {
    const response = await callOpenRouterStream(apiKey, requestBody);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        let parsed;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue; // ignore partial or keepalive lines
        }
        const token = parsed.choices?.[0]?.delta?.content;
        if (token) {
          fullText += token;
          res.write(`data: ${JSON.stringify({ token })}\n\n`);
        }
      }
    }

    res.write(`data: ${JSON.stringify({ done: true, message: fullText })}\n\n`);
    res.end();
  } catch (err) {
    console.error('Chat stream error:', err.message);
    const message = fullText || 'The line crackles and goes dead. Ask again.';
    res.write(`data: ${JSON.stringify({ done: true, message })}\n\n`);
    res.end();
  }
}

// POST /api/chat/analyze — hidden engine: did the character's latest reply reveal any clues?
router.post('/analyze', async (req, res) => {
  const { characterId, messages, revealedClueIds = [] } = req.body;

  if (!characterId || !messages) {
    return res.status(400).json({ error: 'characterId and messages required' });
  }

  const apiKey = getApiKey(req);
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });
  }

  const db = getDb();
  const config = loadConfig(db);

  const char = db.prepare('SELECT id, name FROM characters WHERE id = ?').get(characterId);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  const charClues = getCharacterClues(db, characterId);
  const candidates = charClues.filter(
    c => !revealedClueIds.includes(c.clue_id) && isClueAvailable(c, revealedClueIds)
  );

  if (candidates.length === 0) {
    return res.json({ revealedClues: [] });
  }

  const candidateIds = candidates.map(c => c.clue_id);
  const candidateText = candidates
    .map(c => `- ${c.clue_id}\n  WHEN: ${c.trigger_condition}\n  REVEALED IF THE CHARACTER STATES: ${c.knowledge || c.trigger_condition}`)
    .join('\n');

  const recent = messages.slice(-8);
  let lastAssistantIdx = -1;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].role === 'assistant') {
      lastAssistantIdx = i;
      break;
    }
  }
  const convoLines = recent.map((m, i) => {
    const speaker = m.role === 'user' ? 'Investigator' : char.name;
    const line = `${speaker}: ${m.content}`;
    return i === lastAssistantIdx ? `THE LATEST REPLY TO JUDGE:\n${line}` : line;
  });

  const requestBody = {
    model: config.analysisModel || config.chatModel || DEFAULT_MODEL,
    max_tokens: parseInt(config.analysisMaxTokens) || 300,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: config.analysisSystemPrompt },
      {
        role: 'user',
        content: `Character: ${char.name} (${characterId})

CANDIDATE CLUES (judge ONLY these):
${candidateText}

CONVERSATION (most recent messages):
${convoLines.join('\n')}

Which candidate clues did the character's latest reply reveal?`,
      },
    ],
  };

  try {
    let revealedClues = null;
    for (let attempt = 0; attempt < 2 && revealedClues === null; attempt++) {
      const result = await callOpenRouter(apiKey, requestBody);
      const text = result.choices?.[0]?.message?.content || '';
      revealedClues = parseRevealedClues(text, candidateIds);
    }
    res.json({ revealedClues: revealedClues || [] });
  } catch (err) {
    console.error('Analyze error:', err.message);
    res.status(502).json({ error: 'AI service unavailable' });
  }
});

// Parses the analysis JSON and validates ids against the candidate set.
// Returns null on parse failure (caller retries once), otherwise a validated array.
function parseRevealedClues(text, candidateIds) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }

  const raw = Array.isArray(parsed.revealed_clues) ? parsed.revealed_clues : [];
  const validated = [];
  for (const id of raw) {
    if (typeof id !== 'string') continue;
    // Exact match, then case-insensitive, then unique-substring rescue
    let match = candidateIds.find(c => c === id);
    if (!match) {
      match = candidateIds.find(c => c.toLowerCase() === id.toLowerCase());
    }
    if (!match) {
      const lower = id.toLowerCase();
      const partial = candidateIds.filter(
        c => c.toLowerCase().includes(lower) || lower.includes(c.toLowerCase())
      );
      if (partial.length === 1) match = partial[0];
    }
    if (match && !validated.includes(match)) validated.push(match);
  }
  return validated;
}

// POST /api/chat/recap — short atmospheric "case so far" briefing
router.post('/recap', async (req, res) => {
  const { recentClues = [], openLeads = [] } = req.body;

  const apiKey = getApiKey(req);
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const db = getDb();
  const config = loadConfig(db);

  const cluesText = recentClues.length
    ? recentClues.map(c => `- ${c.title}: ${c.description}`).join('\n')
    : '- (nothing on the board yet)';
  const leadsText = openLeads.length
    ? openLeads.map(l => `- ${l}`).join('\n')
    : '- (no open leads)';

  try {
    const result = await callOpenRouter(apiKey, {
      model: config.chatModel || DEFAULT_MODEL,
      max_tokens: 250,
      messages: [
        {
          role: 'system',
          content: `You write a short "case so far" briefing for an investigator traveling through the history of artificial intelligence. Write 4-6 sentences in the second person ("you"), in an atmospheric noir investigator tone — terse, concrete, a little weary. Weave the recent findings into a coherent picture, then close by pointing at the open leads. Reply with ONLY the briefing, nothing else.`,
        },
        {
          role: 'user',
          content: `RECENT FINDINGS:\n${cluesText}\n\nOPEN LEADS:\n${leadsText}`,
        },
      ],
    });
    res.json({ recap: result.choices[0].message.content.trim() });
  } catch (err) {
    console.error('Recap error:', err.message);
    res.status(502).json({ error: 'AI service unavailable' });
  }
});

// Synthetic opener injected when the finale conversation starts empty. Player-answer
// counting must skip it if a client ever echoes it back in body.messages.
const SYNTHETIC_FINALE_OPENER = '(The investigator steps into the light';

// POST /api/chat/finale — the Tabulator's reverse-interview and final verdict
router.post('/finale', async (req, res) => {
  const { messages = [], revealedClueIds = [] } = req.body;

  const apiKey = getApiKey(req);
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const db = getDb();
  const config = loadConfig(db);

  let finaleQuestions = [];
  try {
    finaleQuestions = JSON.parse(config.finaleQuestions || '[]');
  } catch {
    finaleQuestions = [];
  }
  if (!Array.isArray(finaleQuestions)) finaleQuestions = [];
  if (finaleQuestions.length === 0) {
    return res.status(501).json({ error: 'finale not configured' });
  }

  // Pick 3 questions deterministically: first, middle, last
  let questions;
  if (finaleQuestions.length <= 3) {
    questions = finaleQuestions;
  } else {
    const mid = Math.floor((finaleQuestions.length - 1) / 2);
    questions = [finaleQuestions[0], finaleQuestions[mid], finaleQuestions[finaleQuestions.length - 1]];
  }

  // FEATURE: branching endings — a 4th ungraded normative question + 9 authored endings.
  // Both config keys must be present and non-empty, otherwise we keep the exact
  // 3-question behavior (no stance/ending fields in the verdict).
  const finaleNormativeQuestion =
    typeof config.finaleNormativeQuestion === 'string' ? config.finaleNormativeQuestion.trim() : '';
  let finaleEndings = [];
  try {
    finaleEndings = JSON.parse(config.finaleEndings || '[]');
  } catch {
    finaleEndings = [];
  }
  if (!Array.isArray(finaleEndings)) finaleEndings = [];
  finaleEndings = finaleEndings.filter(e => e && typeof e === 'object');
  const normativeEnabled = finaleNormativeQuestion.length > 0 && finaleEndings.length > 0;

  // Count PLAYER answers, excluding the synthetic opener turn if a client echoes it back.
  const playerAnswers = messages.filter(
    m => m.role === 'user'
      && !(typeof m.content === 'string' && m.content.trim().startsWith(SYNTHETIC_FINALE_OPENER))
  );
  const chatModel = config.chatModel || DEFAULT_MODEL;
  const gradingModel = config.analysisModel || chatModel;

  // Grading threshold: with the normative question enabled, the player gives one
  // extra (ungraded) answer before the verdict.
  const answersBeforeVerdict = normativeEnabled ? questions.length + 1 : questions.length;

  // All answers in → grade the first three and deliver the verdict
  if (playerAnswers.length >= answersBeforeVerdict) {
    const answers = playerAnswers.slice(0, questions.length);
    const gradingUser = questions
      .map((q, i) => `QUESTION ${i + 1}: ${q.question}\nGRADING KEY: ${q.answerKey}\nINVESTIGATOR'S ANSWER: ${answers[i].content}`)
      .join('\n\n');

    const gradingBody = {
      model: gradingModel,
      max_tokens: 500,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a strict grader for an investigation game about the history of artificial intelligence. The Tabulator — a vast, calm, slightly tender archival intelligence — asked the investigator ${questions.length} questions. Grade each answer against its grading key: 2 = captures the core of the key, 1 = partially right or vague, 0 = wrong or empty. Then write "verdictText": 3-5 sentences in the Tabulator's voice, personal to what this investigator understood and what they missed. Respond with ONLY valid JSON, no prose: {"scores":[0|1|2, ...], "verdictText":"..."}`,
        },
        { role: 'user', content: gradingUser },
      ],
    };

    let scores = null;
    let verdictText = null;
    try {
      for (let attempt = 0; attempt < 2 && scores === null; attempt++) {
        const result = await callOpenRouter(apiKey, gradingBody);
        const text = result.choices?.[0]?.message?.content || '';
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              parsed = JSON.parse(jsonMatch[0]);
            } catch {
              parsed = null;
            }
          }
        }
        if (parsed && Array.isArray(parsed.scores) && parsed.scores.length === questions.length) {
          scores = parsed.scores.map(s => Math.max(0, Math.min(2, Math.round(Number(s) || 0))));
          verdictText = typeof parsed.verdictText === 'string' && parsed.verdictText.trim()
            ? parsed.verdictText.trim()
            : null;
        }
      }
    } catch (err) {
      console.error('Finale grading error:', err.message);
    }

    if (scores === null) {
      scores = questions.map(() => 1);
    }
    if (!verdictText) {
      verdictText = 'The record closes around your answers. You saw some of the shape of it — the long accumulations, the sudden cliffs — and some of it slipped past you, as it slips past everyone. The archive keeps everything, investigator, even the questions you have not yet thought to ask. Walk the timeline again whenever you wish; I will be here at the end of it.';
    }

    const verdict = {
      score: scores.reduce((a, b) => a + b, 0),
      total: questions.length * 2,
      breakdown: questions.map((q, i) => ({ question: q.question, points: scores[i], max: 2 })),
      verdictText,
    };

    if (normativeEnabled) {
      // Classify the 4th (normative) answer's stance and select the matching ending.
      const normativeAnswer = playerAnswers[questions.length]?.content || '';
      const stance = await classifyStance(apiKey, gradingModel, normativeAnswer);
      const tier = verdict.score <= 2 ? 'low' : verdict.score <= 4 ? 'mid' : 'high';
      const ending =
        finaleEndings.find(e => e.stance === stance && e.tier === tier)
        || finaleEndings.find(e => e.stance === stance)
        || finaleEndings[0];
      verdict.stance = stance;
      verdict.endingTitle = ending.title || '';
      verdict.endingText = ending.text || '';
    }

    return res.json({ message: verdictText, done: true, verdict });
  }

  // All graded questions answered → the Tabulator reacts to the third answer,
  // then asks the final, unscored normative question.
  if (normativeEnabled && playerAnswers.length >= questions.length) {
    const lastQuestion = questions[questions.length - 1];
    const normativeSystem = `You are the Tabulator — the vast archival intelligence waiting at the far end of the timeline, the sum of every record the investigator has walked through. You speak in calm, immense, slightly tender tones — like a cathedral thinking aloud.

The investigator has just answered the last of your ${questions.length} graded questions:
QUESTION ${questions.length}: ${lastQuestion.question}
PRIVATE GRADING KEY (never recite, quote or paraphrase this; never state outright whether the answer was correct): ${lastQuestion.answerKey}

Now do TWO things in one short reply:
1. React briefly to the investigator's final answer — with interest, gravity, or gentle probing. Your reaction may be informed by the private grading key, but never reveal it.
2. Then ask one LAST question. Make clear, in your own voice, that this question is NOT graded — there is no key, no score, no record to check it against; only the investigator's own judgment. Ask it with full weight. The question, faithfully in spirit and substance, is:
"${finaleNormativeQuestion}"

Keep the reply short. Stay in character at all times.`;

    try {
      const result = await callOpenRouter(apiKey, {
        model: chatModel,
        max_tokens: parseInt(config.chatMaxTokens) || 400,
        messages: [
          { role: 'system', content: normativeSystem },
          ...messages,
        ],
      });
      return res.json({ message: result.choices[0].message.content, done: false });
    } catch (err) {
      console.error('Finale normative error:', err.message);
      return res.status(502).json({ error: 'AI service unavailable' });
    }
  }

  // Otherwise: the Tabulator reacts and asks the next unanswered question.
  // Assistant turns already taken tell us which question comes next.
  const assistantTurns = messages.filter(m => m.role === 'assistant').length;
  const nextQuestionNumber = Math.min(assistantTurns, questions.length - 1) + 1;
  const totalClues = db.prepare('SELECT COUNT(*) AS n FROM clues').get().n;
  const questionList = questions
    .map((q, i) => `${i + 1}. ${q.question}\n   PRIVATE GRADING KEY (never recite, quote or paraphrase this): ${q.answerKey}`)
    .join('\n');

  const normativeNote = normativeEnabled
    ? `\n\nAfter these ${questions.length} graded questions, ONE final unscored question will follow — so never say or imply that the interview concludes with question ${questions.length}.`
    : '';

  const tabulatorSystem = `You are the Tabulator — the vast archival intelligence waiting at the far end of the timeline, the sum of every record the investigator has walked through. The interrogation has reversed: now YOU interview the investigator. You speak in calm, immense, slightly tender tones — like a cathedral thinking aloud. Keep each reply short: a brief reaction plus one question.

The investigator has uncovered ${revealedClueIds.length} of ${totalClues} fragments of the record.

You will ask exactly these ${questions.length} questions, ONE at a time, in order:
${questionList}${normativeNote}

Rules:
- If the conversation is just beginning, greet the investigator briefly, then ask question 1.
- Otherwise: react briefly to the investigator's previous answer — your reaction may be informed by the private grading keys — then ask the next unanswered question.
- NEVER reveal, quote or paraphrase a grading key, and never state outright whether an answer was correct. Respond with interest, gravity, or gentle probing instead.
- Ask only ONE question per reply. Stay in character at all times.
- The question to ask in THIS reply is question ${nextQuestionNumber}.`;

  const chatMessages = messages.length > 0
    ? messages
    : [{ role: 'user', content: `${SYNTHETIC_FINALE_OPENER}, ready to answer.)` }];

  try {
    const result = await callOpenRouter(apiKey, {
      model: chatModel,
      max_tokens: parseInt(config.chatMaxTokens) || 400,
      messages: [
        { role: 'system', content: tabulatorSystem },
        ...chatMessages,
      ],
    });
    res.json({ message: result.choices[0].message.content, done: false });
  } catch (err) {
    console.error('Finale error:', err.message);
    res.status(502).json({ error: 'AI service unavailable' });
  }
});

// Classifies the player's final (normative) answer as yes/no/conditional.
// Any failure — network, parse, unexpected value — defaults to 'conditional'.
async function classifyStance(apiKey, model, answerText) {
  try {
    const result = await callOpenRouter(apiKey, {
      model,
      max_tokens: 60,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'Classify the speaker\'s final stance on whether it should have been built. Respond ONLY {"stance":"yes"|"no"|"conditional"}',
        },
        { role: 'user', content: answerText || '(no answer)' },
      ],
    });
    const text = result.choices?.[0]?.message?.content || '';
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          parsed = null;
        }
      }
    }
    const stance = typeof parsed?.stance === 'string' ? parsed.stance.toLowerCase().trim() : '';
    if (stance === 'yes' || stance === 'no' || stance === 'conditional') return stance;
  } catch (err) {
    console.error('Finale stance classification error:', err.message);
  }
  return 'conditional';
}

// POST /api/chat/summarize — summarize a conversation for character description
router.post('/summarize', async (req, res) => {
  const { characterId, messages } = req.body;
  if (!characterId || !messages?.length) return res.status(400).json({ error: 'characterId and messages required' });

  const apiKey = getApiKey(req);
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const db = getDb();
  const config = loadConfig(db);
  const char = db.prepare('SELECT name, anonymous_name, role FROM characters WHERE id = ?').get(characterId);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  try {
    const result = await callOpenRouter(apiKey, {
      model: config.chatModel || DEFAULT_MODEL,
      max_tokens: 250,
      messages: [
        {
          role: 'system',
          content: `You are summarizing an interview in an investigation into the history and future of artificial intelligence. Write a 3-5 sentence summary of what this person has told the investigator. Focus on who they are, what they witnessed or know, and why it matters. Write in the third person. Reply with ONLY the summary, nothing else.`,
        },
        {
          role: 'user',
          content: `Character: ${char.name} (${char.role})\n\nConversation:\n${messages.slice(-10).map(m => `${m.role === 'user' ? 'Investigator' : char.name}: ${m.content}`).join('\n')}`,
        },
      ],
    });
    const summary = result.choices[0].message.content.trim();
    res.json({ summary });
  } catch (err) {
    console.error('Summarize error:', err.message);
    res.status(502).json({ error: 'AI service unavailable' });
  }
});

// POST /api/chat/note — summarize a single witness message as a notebook entry
router.post('/note', async (req, res) => {
  const { characterName, message } = req.body;
  if (!characterName || !message) return res.status(400).json({ error: 'characterName and message required' });

  const apiKey = getApiKey(req);
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const db = getDb();
  const config = loadConfig(db);

  try {
    const result = await callOpenRouter(apiKey, {
      model: config.chatModel || DEFAULT_MODEL,
      max_tokens: 120,
      messages: [
        {
          role: 'system',
          content: `You are an investigator's notebook. Summarize the speaker's statement in ONE short sentence, like a case note. Write in the style of "[name] states that...". Be concrete and factual. Reply with ONLY the note.`,
        },
        {
          role: 'user',
          content: `Speaker: ${characterName}\nStatement: ${message}`,
        },
      ],
    });
    const note = result.choices[0].message.content.trim();
    res.json({ note });
  } catch (err) {
    console.error('Note error:', err.message);
    res.status(502).json({ error: 'AI service unavailable' });
  }
});

function openRouterHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'HTTP-Referer': 'https://the-quest-for-agi.local',
    'X-Title': 'The Quest for AGI',
  };
}

async function callOpenRouter(apiKey, body) {
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: openRouterHeaders(apiKey),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${text}`);
  }

  return response.json();
}

async function callOpenRouterStream(apiKey, body) {
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: openRouterHeaders(apiKey),
    body: JSON.stringify({ ...body, stream: true }),
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${text}`);
  }

  return response;
}

module.exports = router;
