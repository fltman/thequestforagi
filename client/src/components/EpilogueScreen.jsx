import { useState, useEffect } from 'react';

export default function EpilogueScreen({ stats = {}, verdict = null, onContinue }) {
  const hasEnding = Boolean(verdict?.endingTitle);
  // Delay (ms) before each beat fades in:
  //   with ending:  headline → endingTitle → endingText → verdict → stats → closing
  //   otherwise:    headline → verdict → stats → closing
  const delays = hasEnding
    ? [600, 2200, 1800, 2600, 2600, 2200]
    : verdict ? [600, 2200, 2600, 2200] : [600, 200, 2000, 2200];
  const totalBeats = delays.length;
  const [beat, setBeat] = useState(0);

  // Beat indices shift when the ending beats are present
  const endingTitleBeat = 1;
  const endingTextBeat = 2;
  const verdictBeat = hasEnding ? 3 : 1;
  const statsBeat = hasEnding ? 4 : 2;
  const closingBeat = hasEnding ? 5 : 3;

  useEffect(() => {
    if (beat >= totalBeats) return;
    const t = setTimeout(() => setBeat(b => b + 1), delays[beat]);
    return () => clearTimeout(t);
  }, [beat, totalBeats]);

  const beatClass = (i) =>
    `transition-all duration-1000 ease-out ${beat > i ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`;

  const statItems = [
    { label: 'Clues', value: `${stats.cluesFound ?? 0} / ${stats.cluesTotal ?? 0}` },
    { label: 'Timeline nodes', value: `${stats.locationsUnlocked ?? 0} / ${stats.locationsTotal ?? 0}` },
    { label: 'Minds interviewed', value: `${stats.charactersMet ?? 0} / ${stats.charactersTotal ?? 0}` },
  ];

  return (
    <div
      className="fixed inset-0 z-[80] bg-noir-950 overflow-y-auto"
      onClick={beat < totalBeats ? () => setBeat(totalBeats) : undefined}
    >
      <div className="fixed inset-0 bg-gradient-to-t from-noir-950 via-noir-950 to-noir-900/60 pointer-events-none" />
      <div className="relative min-h-full flex flex-col items-center justify-center px-6 py-12 text-center">
        <div className="w-full max-w-xl space-y-8">
          <h1 className={`font-serif text-3xl md:text-5xl text-white leading-tight ${beatClass(0)}`}>
            THE LAST QUESTION HAS BEEN ASKED.
          </h1>

          {hasEnding && (
            <>
              <h2
                className={`font-serif text-2xl md:text-4xl text-clue leading-tight ${beatClass(endingTitleBeat)}`}
                style={{ textShadow: '0 0 30px rgba(217,119,6,0.30)' }}
              >
                {verdict.endingTitle}
              </h2>
              <p className={`max-w-prose mx-auto text-left font-serif text-base md:text-lg text-zinc-300 leading-relaxed ${beatClass(endingTextBeat)}`}>
                {verdict.endingText}
              </p>
            </>
          )}

          {verdict && (
            <div className={`space-y-5 ${beatClass(verdictBeat)}`}>
              <blockquote className="border-l-2 border-clue pl-4 text-left font-mono text-sm text-zinc-300 leading-relaxed italic">
                &ldquo;{verdict.verdictText}&rdquo;
              </blockquote>
              <p className="font-serif text-4xl text-clue">
                {verdict.score} <span className="text-zinc-600">/</span> {verdict.total}
              </p>
              {verdict.breakdown?.length > 0 && (
                <div className="space-y-1.5 text-left max-w-md mx-auto">
                  {verdict.breakdown.map((row, i) => (
                    <div key={i} className="flex items-baseline justify-between gap-4 font-mono text-xs">
                      <span className="text-zinc-500">{row.question}</span>
                      <span className={`shrink-0 ${row.points >= row.max ? 'text-clue' : row.points > 0 ? 'text-zinc-300' : 'text-zinc-600'}`}>
                        {row.points} / {row.max}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className={`grid grid-cols-3 gap-3 ${beatClass(statsBeat)}`}>
            {statItems.map(s => (
              <div key={s.label} className="bg-noir-900/80 border border-noir-700 rounded-lg px-3 py-4">
                <p className="font-serif text-xl md:text-2xl text-zinc-100">{s.value}</p>
                <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500 mt-1">{s.label}</p>
              </div>
            ))}
          </div>

          <div className={`space-y-6 ${beatClass(closingBeat)} ${beat > closingBeat ? '' : 'pointer-events-none'}`}>
            <p className="font-mono text-base text-zinc-400">The timeline remains open.</p>
            <button
              onClick={(e) => { e.stopPropagation(); onContinue(); }}
              className="px-8 py-3 border border-clue text-clue font-mono text-sm uppercase tracking-widest
                         hover:bg-clue hover:text-noir-950 transition-all duration-300"
            >
              Keep exploring
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
