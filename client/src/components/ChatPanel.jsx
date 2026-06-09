import { useState, useEffect, useRef, useCallback } from 'react';
import {
  fetchCharacter,
  sendMessageStream,
  analyzeConversation,
  summarizeConversation,
  ASSET_BASE,
} from '../lib/api';

export function renderMarkdown(text, classes = {}) {
  const strongClass = classes.strong || 'font-bold text-zinc-100';
  // *stage directions* render in clue gold so acting stands apart from speech
  const emClass = classes.em || 'italic text-clue/90';
  const parts = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[2]) {
      parts.push(<strong key={match.index} className={strongClass}>{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(<em key={match.index} className={emClass}>{match[3]}</em>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

// Number of user messages since the last assistant message that revealed clues
// (counts from conversation start if no reveal has ever happened).
function computeTurnsSinceReveal(messages) {
  let lastRevealIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && Array.isArray(msg.clues) && msg.clues.length > 0) {
      lastRevealIndex = i;
      break;
    }
  }
  let turns = 0;
  for (let i = lastRevealIndex + 1; i < messages.length; i++) {
    if (messages[i].role === 'user') turns++;
  }
  return turns;
}

export default function ChatPanel({
  characterId,
  locationId,
  locations,
  conversations,
  revealedClueIds,
  revealedNames = [],
  characterSummaries = {},
  clues = [],
  clueTypes = [],
  isLoading,
  dispatch,
  onSaveConversation,
  onAddNote,
}) {
  const [character, setCharacter] = useState(null);
  const [input, setInput] = useState('');
  const [notingIndex, setNotingIndex] = useState(null);
  const [streamingText, setStreamingText] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = localStorage.getItem('palme_chat_width');
    return saved ? Number(saved) : 384;
  });
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const isDragging = useRef(false);
  const openingLineFired = useRef(false);

  const handleDragStart = useCallback((e) => {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startWidth = panelWidth;
    const onMove = (e) => {
      if (!isDragging.current) return;
      setPanelWidth(Math.max(320, Math.min(700, startWidth + (startX - e.clientX))));
    };
    const onUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setPanelWidth(w => { localStorage.setItem('palme_chat_width', String(w)); return w; });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [panelWidth]);
  const messages = conversations[characterId] || [];
  const location = locations.find(l => l.id === locationId);
  const nameRevealed = revealedNames.includes(characterId);

  const clueById = {};
  for (const c of clues) clueById[c.id] = c;
  const clueTypeById = {};
  for (const ct of clueTypes) clueTypeById[ct.id] = ct;

  useEffect(() => {
    openingLineFired.current = false;
    fetchCharacter(characterId).then(setCharacter);
  }, [characterId]);

  // Opening line: fire once when the character has loaded and the conversation is empty
  useEffect(() => {
    if (!character || character.id !== characterId) return;
    if (openingLineFired.current) return;
    if (!character.openingLine) return;
    if ((conversations[characterId] || []).length > 0) return;
    openingLineFired.current = true;
    dispatch({ type: 'ADD_MESSAGE', characterId, role: 'assistant', content: character.openingLine });
  }, [character, characterId, conversations, dispatch]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, streamingText]);

  // Refocus input after loading finishes
  useEffect(() => {
    if (!isLoading) {
      inputRef.current?.focus();
    }
  }, [isLoading]);

  // Check if character reveals their name in any message. Matches any substantial
  // name token ("I.J. Good" → "Good"), not just the first token (often an initial).
  // Common-word surnames only count inside a name phrase ("Jack Good", not "Good question").
  useEffect(() => {
    if (!character || nameRevealed) return;
    const COMMON_WORD_NAMES = new Set(['Good', 'Young', 'King', 'Strong', 'Long', 'Black', 'White', 'Brown', 'Park', 'Hill', 'Stone', 'Bell', 'Day', 'Wolf']);
    const tokens = character.name
      .replace(/\s*\([^)]*\)\s*$/, '') // strip the "(YYYY)" era suffix
      .split(/\s+/)
      .filter(t => t.replace(/\./g, '').length >= 3);
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const revealed = messages.some(m =>
      m.role === 'assistant' &&
      tokens.some(t => {
        const pattern = COMMON_WORD_NAMES.has(t)
          ? `[A-Z][a-z]+\\s+${esc(t)}(?![a-z])` // require "Firstname Good"-style phrase
          : `(?<![A-Za-z])${esc(t)}(?![a-z])`;
        return new RegExp(pattern).test(m.content);
      })
    );
    if (revealed) dispatch({ type: 'REVEAL_NAME', characterId });
  }, [messages, character, characterId, nameRevealed, dispatch]);

  // Save conversation when leaving chat
  const handleBack = () => {
    if (onSaveConversation) onSaveConversation(characterId);
    // Generate AI summary if we have enough messages
    if (messages.length >= 2) {
      summarizeConversation(characterId, messages).then(summary => {
        if (summary) dispatch({ type: 'SET_CHARACTER_SUMMARY', characterId, summary });
      }).catch(() => {});
    }
    dispatch({ type: 'OPEN_LOCATION', locationId });
  };

  async function sendUserMessage(text) {
    const userMessage = text.trim();
    if (!userMessage || isLoading) return;

    dispatch({ type: 'ADD_MESSAGE', characterId, role: 'user', content: userMessage });
    dispatch({ type: 'SET_LOADING', loading: true });

    const updatedMessages = [...messages, { role: 'user', content: userMessage }];
    const turnsSinceReveal = computeTurnsSinceReveal(messages);

    let fullMessage = null;
    try {
      fullMessage = await sendMessageStream(
        characterId,
        updatedMessages,
        revealedClueIds,
        turnsSinceReveal,
        (token) => setStreamingText(prev => (prev == null ? token : prev + token)),
      );
      dispatch({ type: 'ADD_MESSAGE', characterId, role: 'assistant', content: fullMessage });
    } catch {
      dispatch({
        type: 'ADD_MESSAGE',
        characterId,
        role: 'assistant',
        content: 'The character is not responding right now. Try again.',
      });
    } finally {
      setStreamingText(null);
      dispatch({ type: 'SET_LOADING', loading: false });
    }

    // Decoupled analysis: runs after the reply, without blocking input
    if (fullMessage != null) {
      const finalMessages = [...updatedMessages, { role: 'assistant', content: fullMessage }];
      analyzeConversation(characterId, finalMessages, revealedClueIds)
        .then(clueIds => {
          if (Array.isArray(clueIds) && clueIds.length > 0) {
            dispatch({ type: 'REVEAL_CLUES', clueIds });
            dispatch({ type: 'SET_MESSAGE_CLUES', characterId, index: finalMessages.length - 1, clueIds });
          }
        })
        .catch(() => {});
    }
  }

  function handleSend(e) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    const text = input;
    setInput('');
    sendUserMessage(text);
  }

  function handleSuggestionClick(question) {
    if (isLoading) return;
    setShowSuggestions(false);
    sendUserMessage(question);
  }

  const displayName = nameRevealed
    ? character?.name
    : (character?.anonymous_name || 'Unknown');
  const summary = characterSummaries[characterId];

  const characterClueIds = Array.isArray(character?.clues)
    ? character.clues.map(c => (typeof c === 'string' ? c : c?.clue_id || c?.id)).filter(Boolean)
    : [];
  const revealedCount = characterClueIds.filter(id => revealedClueIds.includes(id)).length;
  const exhausted = characterClueIds.length > 0 && revealedCount === characterClueIds.length;

  const suggestions = Array.isArray(character?.suggestedQuestions) ? character.suggestedQuestions : [];
  const hasUserMessages = messages.some(m => m.role === 'user');
  const suggestionsVisible = suggestions.length > 0 && (!hasUserMessages || showSuggestions);

  return (
    <div className="absolute right-0 top-0 bottom-0 w-full md:w-auto bg-noir-900/95 backdrop-blur-sm
                    border-l border-noir-700 z-20 flex flex-col" style={{ width: window.innerWidth < 768 ? '100%' : panelWidth }}>
      <style>{`
        @keyframes clueChipIn {
          0%   { opacity: 0; transform: translateY(8px) scale(0.9); box-shadow: 0 0 0 0 rgba(217, 119, 6, 0); }
          55%  { opacity: 1; transform: translateY(-2px) scale(1.04); box-shadow: 0 0 14px 2px rgba(217, 119, 6, 0.35); }
          100% { opacity: 1; transform: translateY(0) scale(1); box-shadow: 0 0 0 0 rgba(217, 119, 6, 0); }
        }
        .clue-chip { animation: clueChipIn 0.5s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>
      {/* Drag handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blood/30 transition-colors z-30"
        onMouseDown={handleDragStart}
      />
      {/* Header with full-width portrait */}
      <div className="flex-shrink-0">
        <div className="relative">
          <img
            src={`${ASSET_BASE}/images/characters/${characterId}.jpg`}
            alt=""
            className="w-full h-48 object-cover portrait-pan"
            onError={(e) => { e.target.style.display = 'none'; }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-noir-900 via-noir-900/30 to-transparent" />
          <button
            onClick={handleBack}
            className="absolute top-3 left-3 text-zinc-300 hover:text-white font-mono text-sm flex items-center gap-1
                       bg-noir-900/60 backdrop-blur-sm px-2 py-1 rounded"
          >
            &larr; {location?.name || 'Back'}
          </button>
        </div>
        <div className="px-4 pb-3 pt-1 border-b border-noir-700">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-serif text-xl text-white">{displayName}</h2>
            {characterClueIds.length > 0 && (
              <div
                className="flex items-center gap-1 flex-shrink-0"
                title={`Leads: ${revealedCount} of ${characterClueIds.length} uncovered`}
              >
                {characterClueIds.map(id => (
                  <span
                    key={id}
                    className={`font-mono text-[10px] leading-none ${
                      revealedClueIds.includes(id) ? 'text-clue' : 'text-zinc-600'
                    }`}
                  >
                    {revealedClueIds.includes(id) ? '●' : '○'}
                  </span>
                ))}
              </div>
            )}
          </div>
          {exhausted && (
            <p className="font-mono text-[11px] text-zinc-500 mt-0.5">
              ✓ has told you everything they know
            </p>
          )}
          {summary && (
            <div className="mt-1">
              <p className={`font-mono text-xs text-zinc-500 leading-relaxed ${summaryExpanded ? '' : 'line-clamp-2'}`}>
                {summary}
              </p>
              <button
                onClick={() => setSummaryExpanded(e => !e)}
                className="font-mono text-[10px] text-zinc-600 hover:text-zinc-400 mt-0.5"
              >
                {summaryExpanded ? 'Show less' : 'Show more'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} group/msg`}
          >
            <div className="max-w-[85%]">
              <div
                className={`px-4 py-2.5 rounded-lg font-mono text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-accent/20 text-zinc-200 rounded-br-sm'
                    : 'bg-noir-800 text-zinc-300 border border-noir-700 rounded-bl-sm'
                }`}
              >
                {msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content}
              </div>
              {msg.role === 'assistant' && Array.isArray(msg.clues) && msg.clues.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {msg.clues.map((clueId, ci) => {
                    const clue = clueById[clueId];
                    const ct = clueTypeById[clue?.type];
                    return (
                      <span
                        key={clueId}
                        className="clue-chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
                                   border border-clue/40 bg-clue/10 text-clue font-mono text-[11px]"
                        style={{ animationDelay: `${ci * 120}ms` }}
                      >
                        {ct?.icon && <span aria-hidden="true">{ct.icon}</span>}
                        <span>{clue?.title || clueId}</span>
                      </span>
                    );
                  })}
                </div>
              )}
              {msg.role === 'assistant' && onAddNote && (
                <div className="flex justify-end mt-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                  {notingIndex === i ? (
                    <span className="font-mono text-[10px] text-clue animate-pulse">Noting…</span>
                  ) : (
                    <button
                      onClick={async () => {
                        setNotingIndex(i);
                        await onAddNote(displayName, msg.content);
                        setNotingIndex(null);
                      }}
                      className="font-mono text-[10px] text-zinc-600 hover:text-zinc-300 transition-colors"
                    >
                      + Note
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          streamingText != null ? (
            <div className="flex justify-start">
              <div className="max-w-[85%]">
                <div className="px-4 py-2.5 rounded-lg font-mono text-sm leading-relaxed
                                bg-noir-800 text-zinc-300 border border-noir-700 rounded-bl-sm">
                  {renderMarkdown(streamingText)}
                  <span className="inline-block w-1.5 h-3.5 ml-1 align-middle bg-zinc-500 animate-pulse" />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex justify-start">
              <div className="bg-noir-800 border border-noir-700 rounded-lg px-4 py-3 rounded-bl-sm">
                <div className="flex gap-1.5">
                  <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="p-4 border-t border-noir-700 flex-shrink-0">
        {suggestionsVisible && (
          <div className="flex flex-wrap gap-2 mb-3">
            {suggestions.map((question, i) => (
              <button
                key={i}
                type="button"
                disabled={isLoading}
                onClick={() => handleSuggestionClick(question)}
                className="px-3 py-1.5 rounded-full border border-noir-600 bg-noir-800/60
                           font-mono text-xs text-zinc-400 text-left
                           hover:border-clue/50 hover:text-clue transition-colors
                           disabled:opacity-40"
              >
                {question}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2 items-center">
          {hasUserMessages && suggestions.length > 0 && (
            <button
              type="button"
              onClick={() => setShowSuggestions(s => !s)}
              title="Need a lead?"
              className={`flex-shrink-0 font-mono text-[10px] px-1.5 py-2.5 transition-colors ${
                showSuggestions ? 'text-clue' : 'text-zinc-600 hover:text-clue'
              }`}
            >
              Need a lead?
            </button>
          )}
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question…"
            disabled={isLoading}
            autoFocus
            className="flex-1 bg-noir-800 border border-noir-700 rounded-lg px-4 py-2.5
                       font-mono text-sm text-zinc-200 placeholder-zinc-600
                       focus:outline-none focus:border-accent/50"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-4 py-2.5 bg-accent/20 text-accent border border-accent/30 rounded-lg
                       font-mono text-sm hover:bg-accent/30 disabled:opacity-30 transition-colors"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
