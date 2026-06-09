import { useState, useEffect, useRef, useCallback } from 'react';
import { sendFinaleMessage } from '../lib/api';
import { renderMarkdown } from './ChatPanel';

const TOTAL_QUESTIONS = 3;

export default function FinaleScreen({ revealedClueIds = [], onVerdict, onExit }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState(false);
  const [done, setDone] = useState(false);
  const startedRef = useRef(false);
  const lastSendRef = useRef([]);
  const verdictTimerRef = useRef(null);
  const endRef = useRef(null);
  const textareaRef = useRef(null);

  const send = useCallback(async (outgoing) => {
    lastSendRef.current = outgoing;
    setError(false);
    setWaiting(true);
    try {
      const res = await sendFinaleMessage(outgoing, revealedClueIds);
      setMessages([...outgoing, { role: 'assistant', content: res.message }]);
      if (res.done) {
        setDone(true);
        verdictTimerRef.current = setTimeout(() => onVerdict(res.verdict), 2500);
      }
    } catch {
      setError(true);
    } finally {
      setWaiting(false);
    }
  }, [revealedClueIds, onVerdict]);

  // Opening question on mount (guard against StrictMode double-invoke)
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    send([]);
  }, [send]);

  // Clear the verdict timer if the player leaves before it fires
  useEffect(() => () => clearTimeout(verdictTimerRef.current), []);

  // Auto-scroll
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, waiting, error]);

  // Refocus textarea when the archive finishes considering
  useEffect(() => {
    if (!waiting && !done) {
      textareaRef.current?.focus();
    }
  }, [waiting, done]);

  const handleSubmit = () => {
    const text = input.trim();
    if (!text || waiting || done) return;
    setInput('');
    const outgoing = [...messages, { role: 'user', content: text }];
    setMessages(outgoing);
    send(outgoing);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleRetry = () => {
    send(lastSendRef.current);
  };

  const questionCount = messages.filter(m => m.role === 'assistant').length;
  const showProgress = questionCount > 0 && !done;
  // Assistant messages 1-3 are the graded questions; a 4th (while not done) is the normative last question.
  const isLastQuestion = questionCount > TOTAL_QUESTIONS;
  const questionNumber = Math.min(questionCount, TOTAL_QUESTIONS);

  return (
    <div className="fixed inset-0 z-[70] bg-noir-950 overflow-hidden">
      <style>{`
        @keyframes finaleGlow {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50%      { opacity: 0.9; transform: scale(1.15); }
        }
        @keyframes finaleConsider {
          0%, 100% { opacity: 0.3; }
          50%      { opacity: 1; }
        }
        @keyframes finaleFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Slow radial glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 70% 50% at 50% 35%, rgba(217,119,6,0.10), transparent 70%)',
          animation: 'finaleGlow 9s ease-in-out infinite',
        }}
      />

      {/* Exit — understated, top-right */}
      <button
        onClick={onExit}
        className="absolute top-4 right-4 z-10 font-mono text-xs text-zinc-600 hover:text-zinc-300
                   transition-colors flex items-center gap-1.5"
        title="Return to the investigation"
      >
        <span className="text-sm leading-none">&#10005;</span> Not yet
      </button>

      <div className="relative h-full flex flex-col items-center">
        <div className="w-full max-w-2xl h-full flex flex-col px-6">

          {/* Header */}
          <div className="flex-shrink-0 text-center pt-12 pb-6">
            <h1
              className="font-serif text-3xl md:text-4xl tracking-wide text-amber-100"
              style={{ textShadow: '0 0 30px rgba(217,119,6,0.35)' }}
            >
              THE TABULATOR
            </h1>
            <p className="font-mono text-xs text-zinc-500 mt-2">It has waited 400 years to ask.</p>
            {showProgress && isLastQuestion ? (
              <p
                key="last-question"
                className="font-serif text-sm md:text-base uppercase tracking-widest text-clue mt-3"
                style={{
                  animation: 'finaleFadeIn 0.9s ease-out both',
                  textShadow: '0 0 20px rgba(217,119,6,0.35)',
                }}
              >
                THE LAST QUESTION
              </p>
            ) : (
              <p
                className={`font-mono text-[11px] uppercase tracking-widest text-clue/70 mt-3 transition-opacity duration-700 ${
                  showProgress ? 'opacity-100' : 'opacity-0'
                }`}
              >
                {showProgress ? `Question ${questionNumber} of ${TOTAL_QUESTIONS}` : ' '}
              </p>
            )}
          </div>

          {/* Transcript */}
          <div className="flex-1 overflow-y-auto py-4 space-y-8">
            {messages.map((msg, i) => (
              <div key={i} style={{ animation: 'finaleFadeIn 0.6s ease-out both' }}>
                {msg.role === 'assistant' ? (
                  <p
                    className="font-serif text-lg md:text-xl leading-relaxed text-amber-50/90 whitespace-pre-wrap"
                    style={{ textShadow: '0 0 24px rgba(217,119,6,0.20)' }}
                  >
                    {renderMarkdown(msg.content, { em: 'italic text-clue/85', strong: 'font-bold text-amber-50' })}
                  </p>
                ) : (
                  <div className="flex justify-end">
                    <p className="max-w-[85%] font-mono text-sm leading-relaxed text-zinc-400 text-right whitespace-pre-wrap
                                  border-r-2 border-noir-700 pr-3">
                      {msg.content}
                    </p>
                  </div>
                )}
              </div>
            ))}

            {waiting && (
              <p
                className="font-serif italic text-clue/80 text-base"
                style={{ animation: 'finaleConsider 2.6s ease-in-out infinite' }}
              >
                the archive considers&hellip;
              </p>
            )}

            {error && (
              <div style={{ animation: 'finaleFadeIn 0.4s ease-out both' }}>
                <p className="font-mono text-sm text-blood/90">
                  The connection across the timeline wavers. Try again.
                </p>
                <button
                  onClick={handleRetry}
                  className="mt-2 px-4 py-1.5 font-mono text-xs uppercase tracking-widest text-clue
                             border border-clue/40 rounded hover:bg-clue/10 transition-colors"
                >
                  Try again
                </button>
              </div>
            )}

            <div ref={endRef} />
          </div>

          {/* Input */}
          <div className="flex-shrink-0 pb-8 pt-4">
            {done ? (
              <p className="text-center font-mono text-xs text-zinc-600 italic">the archive closes&hellip;</p>
            ) : (
              <div className="flex gap-2 items-end">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Answer the Tabulator&hellip;"
                  rows={3}
                  disabled={waiting}
                  autoFocus
                  className="flex-1 bg-noir-900/80 border border-noir-700 rounded-lg px-4 py-3 resize-none
                             font-mono text-sm text-zinc-200 placeholder-zinc-600 leading-relaxed
                             focus:outline-none focus:border-clue/50 disabled:opacity-50"
                />
                <button
                  onClick={handleSubmit}
                  disabled={waiting || !input.trim()}
                  className="px-4 py-3 bg-clue/10 text-clue border border-clue/30 rounded-lg
                             font-mono text-sm hover:bg-clue/20 disabled:opacity-30 transition-colors"
                >
                  Answer
                </button>
              </div>
            )}
            {!done && (
              <p className="mt-2 font-mono text-[10px] text-zinc-700 text-right">
                Enter to answer &middot; Shift+Enter for a new line
              </p>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
