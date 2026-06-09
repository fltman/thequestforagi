import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import TimelineStrip from './TimelineStrip';

// Marker colors by AGI location type
const MARKER_COLORS = {
  origin: '#22d3ee',    // cyan — origins & breakthroughs
  lab: '#38bdf8',       // blue — research labs
  winter: '#64748b',    // cold grey — the AI winters
  milestone: '#fbbf24', // gold — milestones
  cosmic: '#c026d3',    // magenta — the far future
};

const ICON_BOX = 44; // square box leaves room for the pulsing halo

// Scoped marker CSS, injected by the component so it ships with this file
const MARKER_CSS = `
.agi-marker-wrap { background: transparent; border: none; }
.agi-marker {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.agi-marker-dot {
  width: var(--ms);
  height: var(--ms);
  border-radius: 9999px;
  background: var(--mc);
  border-style: solid;
  box-shadow: 0 0 8px rgba(0, 0, 0, 0.6);
}
.agi-marker-visited .agi-marker-dot {
  opacity: 0.55;
}
.agi-marker-halo {
  position: absolute;
  inset: 0;
  margin: auto;
  width: calc(var(--ms) + 10px);
  height: calc(var(--ms) + 10px);
  border-radius: 9999px;
  border: 2px solid #d97706;
  pointer-events: none;
  animation: agiHaloPulse 2.6s ease-out infinite;
}
@keyframes agiHaloPulse {
  0%   { transform: scale(0.7); opacity: 0.9; }
  70%  { transform: scale(1.7); opacity: 0; }
  100% { transform: scale(1.7); opacity: 0; }
}
.agi-marker-check {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 14px;
  height: 14px;
  border-radius: 9999px;
  background: #14141f;
  border: 1px solid #d97706;
  color: #d97706;
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px;
  line-height: 12px;
  text-align: center;
  pointer-events: none;
}
.agi-focus .agi-marker::after {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  width: var(--ms);
  height: var(--ms);
  border-radius: 9999px;
  border: 3px solid #fbbf24;
  pointer-events: none;
  animation: agiFocusPulse 1.5s ease-out 3;
}
.agi-focus .agi-marker-dot {
  animation: agiFocusDot 1.5s ease-in-out 3;
}
@keyframes agiFocusPulse {
  0%   { transform: scale(0.6); opacity: 1; }
  100% { transform: scale(3.2); opacity: 0; }
}
@keyframes agiFocusDot {
  0%   { transform: scale(1); }
  20%  { transform: scale(1.35); }
  100% { transform: scale(1); }
}
.agi-ghost {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.55;
}
.agi-ghost-dot {
  width: 18px;
  height: 18px;
  border-radius: 9999px;
  border: 1.5px dashed rgba(217, 119, 6, 0.8);
  background: rgba(20, 20, 31, 0.7);
  color: rgba(217, 119, 6, 0.9);
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  line-height: 15px;
  text-align: center;
}
.agi-ghost-badge {
  position: absolute;
  bottom: 2px;
  right: 1px;
  padding: 0 3px;
  border-radius: 4px;
  background: #14141f;
  border: 1px solid #27272a;
  color: #a1a1aa;
  font-family: 'JetBrains Mono', monospace;
  font-size: 8px;
  line-height: 11px;
  pointer-events: none;
}
`;

function buildMarkerIcon(loc, visited) {
  const color = MARKER_COLORS[loc.type] || '#d97706';
  const isStart = !!loc.unlockedByDefault;
  const size = isStart ? 22 : 16;
  const borderWidth = isStart ? 3 : 2;
  const borderColor = visited ? 'rgba(255,255,255,0.3)' : (isStart ? '#ffffff' : 'rgba(255,255,255,0.45)');
  const html = `
    <div class="agi-marker${visited ? ' agi-marker-visited' : ''}" style="--mc:${color};--ms:${size}px">
      ${visited ? '' : '<span class="agi-marker-halo"></span>'}
      <span class="agi-marker-dot" style="border-width:${borderWidth}px;border-color:${borderColor}"></span>
      ${visited ? '<span class="agi-marker-check">✓</span>' : ''}
    </div>`;
  return L.divIcon({
    className: 'agi-marker-wrap',
    html,
    iconSize: [ICON_BOX, ICON_BOX],
    iconAnchor: [ICON_BOX / 2, ICON_BOX / 2],
  });
}

function buildGhostIcon(found, total) {
  const html = `
    <div class="agi-ghost">
      <span class="agi-ghost-dot">?</span>
      <span class="agi-ghost-badge">${found}/${total}</span>
    </div>`;
  return L.divIcon({
    className: 'agi-marker-wrap',
    html,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

export default function GameMap({
  locations,
  unlockedLocationIds,
  revealedClueIds = [],
  visitedLocationIds = [],
  focusLocationId = null,
  onLocationClick,
}) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const markerVisitedRef = useRef({});
  const ghostMarkersRef = useRef({});
  const ghostProgressRef = useRef({});
  const framedKeyRef = useRef(null);
  const focusTimerRef = useRef(null);

  // Initialize map (world view — the investigation spans the globe and beyond)
  useEffect(() => {
    if (mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      center: [30, -10],
      zoom: 2,
      minZoom: 2,
      maxZoom: 12,
      zoomControl: true,
      worldCopyJump: true,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 19,
      className: 'map-tiles-brighter',
    }).addTo(map);

    mapInstanceRef.current = map;

    return () => {
      clearTimeout(focusTimerRef.current);
      map.remove();
      mapInstanceRef.current = null;
      markersRef.current = {};
      markerVisitedRef.current = {};
      ghostMarkersRef.current = {};
      ghostProgressRef.current = {};
      framedKeyRef.current = null;
    };
  }, []);

  // Update unlocked markers (visited vs unvisited styling)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Remove markers for locations no longer unlocked
    for (const [id, marker] of Object.entries(markersRef.current)) {
      if (!unlockedLocationIds.includes(id)) {
        map.removeLayer(marker);
        delete markersRef.current[id];
        delete markerVisitedRef.current[id];
      }
    }

    // Add newly unlocked markers / refresh visited state
    for (const locId of unlockedLocationIds) {
      const loc = locations.find(l => l.id === locId);
      if (!loc) continue;

      const visited = visitedLocationIds.includes(locId);
      const existing = markersRef.current[locId];
      if (existing) {
        if (markerVisitedRef.current[locId] !== visited) {
          existing.setIcon(buildMarkerIcon(loc, visited));
          markerVisitedRef.current[locId] = visited;
        }
        continue;
      }

      const marker = L.marker(loc.coords, { icon: buildMarkerIcon(loc, visited) })
        .addTo(map)
        .on('click', () => onLocationClick(loc.id));

      marker.bindTooltip(loc.name, {
        className: 'map-label',
        direction: 'top',
        offset: [0, -16],
        permanent: true,
      });

      markersRef.current[locId] = marker;
      markerVisitedRef.current[locId] = visited;
    }

    // Frame the unlocked nodes — but only when the unlocked set actually changes,
    // so clue reveals / visits don't yank the camera around
    const framedKey = [...unlockedLocationIds].sort().join('|');
    if (framedKey !== framedKeyRef.current) {
      framedKeyRef.current = framedKey;
      const all = Object.values(markersRef.current);
      if (all.length === 1) {
        map.setView(all[0].getLatLng(), 5, { animate: true });
      } else if (all.length > 1) {
        const group = L.featureGroup(all);
        map.fitBounds(group.getBounds(), { padding: [70, 70], maxZoom: 6, animate: true });
      }
    }
  }, [locations, unlockedLocationIds, visitedLocationIds, onLocationClick]);

  // Ghost markers for partially-gated locations (≥1 unlock clue revealed, not yet unlocked)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const wanted = {};
    for (const loc of locations) {
      if (unlockedLocationIds.includes(loc.id)) continue;
      const unlockedBy = loc.unlockedBy || [];
      if (unlockedBy.length === 0) continue;
      const found = unlockedBy.filter(c => revealedClueIds.includes(c)).length;
      if (found < 1) continue;
      wanted[loc.id] = { loc, found, total: unlockedBy.length };
    }

    // Remove ghosts that unlocked or lost their partial state
    for (const [id, marker] of Object.entries(ghostMarkersRef.current)) {
      if (!wanted[id]) {
        map.removeLayer(marker);
        delete ghostMarkersRef.current[id];
        delete ghostProgressRef.current[id];
      }
    }

    // Add or update ghosts
    for (const [id, { loc, found, total }] of Object.entries(wanted)) {
      const tooltipText = `Timeline coordinate incomplete — ${found}/${total} leads found`;
      const existing = ghostMarkersRef.current[id];
      if (existing) {
        if (ghostProgressRef.current[id] !== found) {
          existing.setIcon(buildGhostIcon(found, total));
          existing.setTooltipContent(tooltipText);
          ghostProgressRef.current[id] = found;
        }
        continue;
      }

      const marker = L.marker(loc.coords, { icon: buildGhostIcon(found, total) })
        .addTo(map)
        .on('click', () => marker.openTooltip());

      marker.bindTooltip(tooltipText, {
        className: 'map-label',
        direction: 'top',
        offset: [0, -14],
      });

      ghostMarkersRef.current[id] = marker;
      ghostProgressRef.current[id] = found;
    }
  }, [locations, unlockedLocationIds, revealedClueIds]);

  // Fly to + highlight a focused location
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !focusLocationId) return;

    const loc = locations.find(l => l.id === focusLocationId);
    if (!loc) return;

    const targetZoom = Math.min((map.getZoom() || 2) + 1, map.getMaxZoom());
    map.flyTo(loc.coords, targetZoom, { duration: 1.8 });

    const el = markersRef.current[focusLocationId]?.getElement();
    if (el) {
      el.classList.add('agi-focus');
      clearTimeout(focusTimerRef.current);
      focusTimerRef.current = setTimeout(() => {
        el.classList.remove('agi-focus');
      }, 5000);
    }
  }, [focusLocationId, locations]);

  return (
    <div className="absolute inset-0 z-0">
      <style>{MARKER_CSS}</style>
      <div ref={mapRef} className="absolute inset-0" />
      <TimelineStrip
        locations={locations}
        unlockedLocationIds={unlockedLocationIds}
        visitedLocationIds={visitedLocationIds}
        revealedClueIds={revealedClueIds}
        onLocationClick={onLocationClick}
      />
    </div>
  );
}
