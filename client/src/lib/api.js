// Detect base path: works both at root (/) and in subdirectories (/palme/)
export const ASSET_BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
const BASE = ASSET_BASE + '/api';
const API_KEY_STORAGE = 'palme_openrouter_key';

export function getStoredApiKey() {
  return localStorage.getItem(API_KEY_STORAGE) || '';
}

export function setStoredApiKey(key) {
  if (key) {
    localStorage.setItem(API_KEY_STORAGE, key);
  } else {
    localStorage.removeItem(API_KEY_STORAGE);
  }
}

export async function verifyApiKey(key) {
  try {
    const res = await fetch(`${BASE}/verify-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    const data = await res.json();
    return !!data.valid;
  } catch {
    return false;
  }
}

function aiHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const key = getStoredApiKey();
  if (key) headers['X-OpenRouter-Key'] = key;
  return headers;
}

export async function fetchLocations() {
  const res = await fetch(`${BASE}/locations`);
  return res.json();
}

export async function fetchCharactersAtLocation(locationId) {
  const res = await fetch(`${BASE}/locations/${locationId}/characters`);
  return res.json();
}

export async function fetchCharacter(characterId) {
  const res = await fetch(`${BASE}/characters/${characterId}`);
  return res.json();
}

export async function fetchClues() {
  const res = await fetch(`${BASE}/clues`);
  return res.json();
}

export async function fetchClueTypes() {
  const res = await fetch(`${BASE}/clue-types`);
  return res.json();
}

export async function fetchConfig() {
  const res = await fetch(`${BASE}/config`);
  return res.json();
}

export async function sendMessage(characterId, messages, revealedClueIds, turnsSinceReveal = 0) {
  const res = await fetch(`${BASE}/chat/message`, {
    method: 'POST',
    headers: aiHeaders(),
    body: JSON.stringify({ characterId, messages, revealedClueIds, turnsSinceReveal }),
  });
  if (!res.ok) {
    throw new Error('Chat request failed');
  }
  return res.json();
}

// Streams the character's reply token by token via SSE.
// Calls onToken(token) per chunk and resolves with the full message.
// On any failure it falls back internally to sendMessage.
export async function sendMessageStream(characterId, messages, revealedClueIds, turnsSinceReveal, onToken) {
  try {
    const res = await fetch(`${BASE}/chat/message`, {
      method: 'POST',
      headers: aiHeaders(),
      body: JSON.stringify({ characterId, messages, revealedClueIds, turnsSinceReveal, stream: true }),
    });
    if (!res.ok || !res.body) {
      throw new Error('Stream request failed');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullMessage = '';
    let finalMessage = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        let event;
        try {
          event = JSON.parse(trimmed.slice(5).trim());
        } catch {
          continue;
        }
        if (event.token) {
          fullMessage += event.token;
          if (onToken) onToken(event.token);
        }
        if (event.done) {
          finalMessage = typeof event.message === 'string' ? event.message : fullMessage;
        }
      }
    }

    if (finalMessage !== null) return finalMessage;
    if (fullMessage) return fullMessage;
    throw new Error('Stream ended without a message');
  } catch {
    const data = await sendMessage(characterId, messages, revealedClueIds, turnsSinceReveal);
    return data.message;
  }
}

// Asks the hidden engine which clues the character's latest reply revealed.
// Returns an array of clue ids, or [] on any failure.
export async function analyzeConversation(characterId, messages, revealedClueIds) {
  try {
    const res = await fetch(`${BASE}/chat/analyze`, {
      method: 'POST',
      headers: aiHeaders(),
      body: JSON.stringify({ characterId, messages, revealedClueIds }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.revealedClues) ? data.revealedClues : [];
  } catch {
    return [];
  }
}

export async function fetchRecap({ recentClues, openLeads }) {
  try {
    const res = await fetch(`${BASE}/chat/recap`, {
      method: 'POST',
      headers: aiHeaders(),
      body: JSON.stringify({ recentClues, openLeads }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.recap || null;
  } catch {
    return null;
  }
}

export async function sendFinaleMessage(messages, revealedClueIds) {
  const res = await fetch(`${BASE}/chat/finale`, {
    method: 'POST',
    headers: aiHeaders(),
    body: JSON.stringify({ messages, revealedClueIds }),
  });
  if (!res.ok) {
    throw new Error('Finale request failed');
  }
  return res.json();
}

export async function createPlayer(name) {
  const res = await fetch(`${BASE}/player`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

export async function loadPlayer(playerId) {
  const res = await fetch(`${BASE}/player/${playerId}`);
  if (!res.ok) return null;
  return res.json();
}

export async function savePlayerState(playerId, state) {
  await fetch(`${BASE}/player/${playerId}/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
}

export async function saveConversation(playerId, characterId, messages) {
  await fetch(`${BASE}/player/${playerId}/conversation/${characterId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });
}

export async function loadBoard(playerId) {
  const res = await fetch(`${BASE}/player/${playerId}/board`);
  if (!res.ok) return null;
  return res.json();
}

export async function saveBoard(playerId, data) {
  await fetch(`${BASE}/player/${playerId}/board`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function loadNotebook(playerId) {
  const res = await fetch(`${BASE}/player/${playerId}/notebook`);
  if (!res.ok) return '';
  const data = await res.json();
  return data.content || '';
}

export async function saveNotebook(playerId, content) {
  await fetch(`${BASE}/player/${playerId}/notebook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

export async function generateNote(characterName, message) {
  const res = await fetch(`${BASE}/chat/note`, {
    method: 'POST',
    headers: aiHeaders(),
    body: JSON.stringify({ characterName, message }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.note;
}

export async function summarizeConversation(characterId, messages) {
  const res = await fetch(`${BASE}/chat/summarize`, {
    method: 'POST',
    headers: aiHeaders(),
    body: JSON.stringify({ characterId, messages }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.summary;
}
