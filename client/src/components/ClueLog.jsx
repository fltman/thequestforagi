import { ASSET_BASE } from '../lib/api';

export default function ClueLog({ clues, clueTypes, revealedClueIds, isOpen, onClose }) {
  const revealedSet = new Set(revealedClueIds);
  const clueMap = {};
  for (const clue of clues) {
    clueMap[clue.id] = clue;
  }

  // Group ALL clues by type, preserving clueTypes order; unknown types appended.
  const typeOrder = clueTypes.map(ct => ct.id);
  const typeMap = {};
  for (const ct of clueTypes) {
    typeMap[ct.id] = ct;
  }
  const grouped = {};
  for (const clue of clues) {
    const type = clue.type || 'unknown';
    if (!grouped[type]) {
      grouped[type] = [];
      if (!typeOrder.includes(type)) typeOrder.push(type);
    }
    grouped[type].push(clue);
  }

  const revealedCount = clues.filter(c => revealedSet.has(c.id)).length;

  const scrollToClue = (clueId) => {
    const el = document.getElementById(`clue-card-${clueId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  if (!isOpen) return null;

  return (
    <div className="absolute left-0 top-0 bottom-0 w-full md:w-80 bg-noir-900/95 backdrop-blur-sm
                    border-r border-noir-700 z-[55] flex flex-col overflow-y-auto">
      <div className="p-6 border-b border-noir-700 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h2 className="font-serif text-xl text-white">Clues</h2>
          <span className="font-mono text-xs text-clue">
            {revealedCount}/{clues.length}
          </span>
        </div>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xl">
          &times;
        </button>
      </div>

      <div className="p-4 space-y-6">
        {typeOrder.map(typeId => {
          const typeClues = grouped[typeId];
          if (!typeClues || typeClues.length === 0) return null;
          const ct = typeMap[typeId];
          const revealed = typeClues.filter(c => revealedSet.has(c.id));
          const locked = typeClues.filter(c => !revealedSet.has(c.id));
          return (
            <div key={typeId}>
              <h3 className="font-mono text-xs uppercase tracking-widest mb-3 flex items-center justify-between gap-2"
                  style={{ color: ct?.color || '#71717a' }}>
                <span className="flex items-center gap-2">
                  <span>{ct?.icon}</span>
                  <span>{ct?.label || typeId}</span>
                </span>
                <span className="opacity-70">{revealed.length}/{typeClues.length}</span>
              </h3>
              <div className="space-y-2">
                {revealed.map(clue => (
                  <RevealedClueCard
                    key={clue.id}
                    clue={clue}
                    clueMap={clueMap}
                    revealedSet={revealedSet}
                    onChipClick={scrollToClue}
                  />
                ))}
                {locked.map(clue => (
                  <LockedClueCard key={clue.id} />
                ))}
              </div>
            </div>
          );
        })}

        {revealedCount === 0 && (
          <p className="font-mono text-sm text-zinc-600 italic text-center py-8">
            No clues yet. Talk to the people you meet across the timeline.
          </p>
        )}
      </div>
    </div>
  );
}

function RevealedClueCard({ clue, clueMap, revealedSet, onChipClick }) {
  const connections = (clue.linkedClues || [])
    .filter(id => revealedSet.has(id) && clueMap[id])
    .map(id => clueMap[id]);

  return (
    <div
      id={`clue-card-${clue.id}`}
      className="bg-noir-800 border rounded-lg font-mono text-xs leading-relaxed overflow-hidden"
      style={{ borderColor: clue.type === 'contradiction' ? '#7c3aed40' : '#27272a' }}
    >
      <img
        src={`${ASSET_BASE}/images/clues/${clue.id}.jpg`}
        alt={clue.title}
        className="w-full h-24 object-cover"
        onError={(e) => { e.target.style.display = 'none'; }}
      />
      <div className="p-3">
        <div className="text-zinc-200 font-medium mb-1">{clue.title}</div>
        <div className="text-zinc-500">{clue.description}</div>
        {connections.length > 0 && (
          <div className="mt-2 pt-2 border-t border-noir-700">
            <div className="text-zinc-600 text-[10px] uppercase tracking-widest mb-1">
              Connects to:
            </div>
            <div className="flex flex-wrap gap-1">
              {connections.map(linked => {
                const purple = linked.type === 'contradiction' || clue.type === 'contradiction';
                return (
                  <button
                    key={linked.id}
                    onClick={() => onChipClick(linked.id)}
                    className="rounded-full px-2 py-0.5 text-[10px] border transition-all"
                    style={purple
                      ? { color: '#a78bfa', borderColor: '#7c3aed66', backgroundColor: '#7c3aed1a' }
                      : { color: '#d97706', borderColor: '#d9770666', backgroundColor: '#d977061a' }}
                  >
                    {linked.title}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LockedClueCard() {
  return (
    <div className="bg-noir-800/40 border border-noir-700 rounded-lg font-mono text-xs
                    px-3 py-2.5 flex items-center gap-2 opacity-60">
      <span className="text-zinc-600">&#x1f512;</span>
      <span className="text-zinc-600 tracking-widest">???</span>
    </div>
  );
}
