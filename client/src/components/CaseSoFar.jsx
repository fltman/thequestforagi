import { useEffect } from 'react';

// onTravel is part of the component contract — reserved for travel links from leads.
export default function CaseSoFar({ playerName, recentClues = [], openLeads = [], recap = null, onClose, onTravel = null }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] flex flex-col bg-noir-900 border border-noir-700 rounded-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-noir-700 flex items-baseline justify-between gap-4">
          <h2 className="font-serif text-xl text-white">THE CASE SO FAR</h2>
          <span className="font-mono text-xs text-zinc-500 truncate">{playerName}</span>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          {recap && (
            <p className="font-mono text-sm text-zinc-300 leading-relaxed border-l-2 border-clue/60 pl-3">
              {recap}
            </p>
          )}

          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-zinc-500 mb-2">Latest evidence:</p>
            {recentClues.length > 0 ? (
              <ul className="space-y-1.5">
                {recentClues.map((clue, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 font-mono text-sm">
                    <span className="text-zinc-200">{clue.title}</span>
                    {clue.type && (
                      <span className="shrink-0 px-1.5 py-0.5 rounded border border-clue/40 text-clue text-[10px] uppercase tracking-wider">
                        {clue.type}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="font-mono text-sm text-zinc-600 italic">Nothing logged yet.</p>
            )}
          </div>

          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-zinc-500 mb-2">Open leads:</p>
            {openLeads.length > 0 ? (
              <ul className="space-y-1.5">
                {openLeads.map((lead, i) => (
                  <li key={i} className="flex gap-2 font-mono text-sm text-zinc-400">
                    <span className="text-blood shrink-0">&#9656;</span>
                    <span>{lead}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="font-mono text-sm text-zinc-600 italic">No open leads. Keep digging.</p>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-noir-700">
          <button
            onClick={onClose}
            className="w-full px-6 py-2.5 border border-blood text-blood font-mono text-xs uppercase tracking-widest
                       hover:bg-blood hover:text-white transition-all duration-300"
          >
            Resume investigation
          </button>
        </div>
      </div>
    </div>
  );
}
