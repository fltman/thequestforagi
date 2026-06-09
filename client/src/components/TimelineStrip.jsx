import { useMemo } from 'react';

const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

function romanFor(era) {
  if (era == null) return '—';
  return ROMAN[era - 1] || String(era);
}

// Parse the year from a location name's "(YYYY)" suffix
function parseYear(name) {
  const match = /\((\d{3,4})\)\s*$/.exec(name || '');
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Docked timeline: navigation + progress meter for the time-travel investigation.
 * Piecewise-linear axis 1843→2387 — equal spacing per sorted distinct year, so
 * empty spans are compressed. Era bands (I–V) group the years.
 */
export default function TimelineStrip({
  locations = [],
  unlockedLocationIds = [],
  visitedLocationIds = [],
  revealedClueIds = [],
  onLocationClick,
}) {
  const groups = useMemo(() => {
    // Visible entries: unlocked locations + partially-gated ones (≥1 unlock clue revealed)
    const entries = [];
    for (const loc of locations) {
      const year = parseYear(loc.name);
      if (year == null) continue;

      if (unlockedLocationIds.includes(loc.id)) {
        entries.push({
          loc,
          year,
          status: visitedLocationIds.includes(loc.id) ? 'visited' : 'unvisited',
        });
      } else {
        const unlockedBy = loc.unlockedBy || [];
        const found = unlockedBy.filter(c => revealedClueIds.includes(c)).length;
        if (unlockedBy.length > 0 && found > 0) {
          entries.push({ loc, year, status: 'partial', found, total: unlockedBy.length });
        }
      }
    }
    if (entries.length === 0) return [];

    // Equal spacing per sorted distinct year
    const years = [...new Set(entries.map(e => e.year))].sort((a, b) => a - b);
    const byYear = {};
    for (const entry of entries) {
      if (!byYear[entry.year]) byYear[entry.year] = [];
      byYear[entry.year].push(entry);
    }

    // Group consecutive years into era bands (era may be null → '—')
    const result = [];
    for (const year of years) {
      const withEra = byYear[year].find(e => e.loc.era != null);
      const era = withEra ? withEra.loc.era : null;
      const eraLabel = withEra ? withEra.loc.eraLabel : null;
      const last = result[result.length - 1];
      if (last && last.era === era) {
        last.years.push({ year, entries: byYear[year] });
        if (!last.eraLabel && eraLabel) last.eraLabel = eraLabel;
      } else {
        result.push({ era, eraLabel, years: [{ year, entries: byYear[year] }] });
      }
    }
    return result;
  }, [locations, unlockedLocationIds, visitedLocationIds, revealedClueIds]);

  if (groups.length === 0) return null;

  return (
    <div className="absolute bottom-2 left-2 right-16 md:bottom-4 md:left-4 md:right-4 z-[1100] pointer-events-auto">
      <div className="mx-auto max-w-5xl bg-noir-900/85 backdrop-blur border border-noir-700 rounded-lg h-10 md:h-14 overflow-x-auto overflow-y-hidden">
        <div className="flex items-stretch h-full min-w-full w-max md:w-auto">
          {groups.map((group, gi) => (
            <div
              key={gi}
              className={`flex flex-col min-w-0 ${gi > 0 ? 'border-l border-noir-700' : ''}`}
              style={{ flexGrow: group.years.length, flexBasis: 0, minWidth: group.years.length * 22 }}
            >
              {/* Era band label */}
              <div className="px-1 md:px-2 pt-0.5 text-[8px] md:text-[10px] font-mono uppercase tracking-wider text-zinc-500 text-center truncate leading-none md:leading-tight">
                <span className="text-clue">{romanFor(group.era)}</span>
                {group.eraLabel && <span className="hidden md:inline"> · {group.eraLabel}</span>}
              </div>

              {/* Year ticks on the axis */}
              <div className="relative flex-1">
                <div className="absolute inset-x-0 top-1/2 h-px bg-noir-700" />
                <div className="relative h-full flex">
                  {group.years.map(({ year, entries }) => (
                    <div key={year} className="flex-1 flex flex-col items-center justify-center min-w-0">
                      <div className="flex items-center gap-0.5">
                        {entries.map(entry => {
                          if (entry.status === 'partial') {
                            return (
                              <span
                                key={entry.loc.id}
                                title={`Timeline coordinate incomplete — ${entry.found}/${entry.total} leads found`}
                                className="w-2.5 h-2.5 md:w-3 md:h-3 flex items-center justify-center text-[8px] md:text-[9px] font-mono text-zinc-600 select-none cursor-default leading-none"
                              >
                                ?
                              </span>
                            );
                          }
                          const visited = entry.status === 'visited';
                          return (
                            <button
                              key={entry.loc.id}
                              type="button"
                              title={entry.loc.name}
                              aria-label={entry.loc.name}
                              onClick={() => onLocationClick && onLocationClick(entry.loc.id)}
                              className={`w-2.5 h-2.5 md:w-3 md:h-3 rounded-full transition-transform hover:scale-125 focus:outline-none focus:ring-1 focus:ring-clue ${
                                visited
                                  ? 'bg-clue shadow-[0_0_6px_rgba(217,119,6,0.8)]'
                                  : 'border md:border-2 border-clue bg-noir-950'
                              }`}
                            />
                          );
                        })}
                      </div>
                      <div className="hidden md:block text-[8px] font-mono text-zinc-600 leading-none mt-0.5">
                        {year}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
