import { useEffect, useRef, useState } from 'react';

const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V'];

// Full-screen act card shown the first time the player enters an era.
// Fades in, auto-dismisses after ~2.8s; any click dismisses immediately.
export default function ActInterstitial({ era, eraLabel, onDone }) {
  const [visible, setVisible] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const fadeIn = requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => onDoneRef.current?.(), 2800);
    return () => {
      cancelAnimationFrame(fadeIn);
      clearTimeout(timer);
    };
  }, []);

  const numeral = ROMAN_NUMERALS[era - 1] || String(era ?? '');
  // Era labels may arrive as "Act III — The Networks Awaken"; the numeral is already huge above
  const label = (eraLabel || '').replace(/^act\s+[ivxlcdm0-9]+\s*[—–-]\s*/i, '');

  return (
    <div
      className="fixed inset-0 z-[75] bg-noir-950/95 flex items-center justify-center cursor-pointer"
      onClick={() => onDoneRef.current?.()}
    >
      <div
        className={`text-center px-6 transition-all duration-[1200ms] ease-out ${
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}
        style={{ textShadow: '0 2px 12px rgba(0,0,0,0.8)' }}
      >
        <p className="font-serif text-7xl md:text-9xl text-white tracking-wide">
          ACT {numeral}
        </p>
        {label && (
          <p className="font-mono text-sm md:text-base uppercase tracking-widest text-clue mt-6">
            {label}
          </p>
        )}
      </div>
    </div>
  );
}
