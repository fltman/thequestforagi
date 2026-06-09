import { useEffect, useRef, useCallback, useState } from 'react';
import { useGameState } from './hooks/useGameState';
import { useMusic, resolveTrack } from './hooks/useMusic';
import { fetchLocations, fetchClues, fetchClueTypes, fetchConfig, fetchRecap, createPlayer, loadPlayer, savePlayerState, saveConversation, generateNote, getStoredApiKey } from './lib/api';
import ApiKeyInput from './components/ApiKeyInput';
import IntroScreen from './components/IntroScreen';
import GameMap from './components/GameMap';
import LocationPanel from './components/LocationPanel';
import ChatPanel from './components/ChatPanel';
import ClueLog from './components/ClueLog';
import InvestigationBoard from './components/InvestigationBoard';
import Notifications from './components/Notifications';
import MusicPlayer from './components/MusicPlayer';
import Notebook, { appendNote } from './components/Notebook';
import FinaleScreen from './components/FinaleScreen';
import EpilogueScreen from './components/EpilogueScreen';
import CaseSoFar from './components/CaseSoFar';
import ActInterstitial from './components/ActInterstitial';

const PLAYERS_KEY = 'palme_players';

// Migrate old single-player localStorage to new format
(function migrate() {
  const oldId = localStorage.getItem('palme_player_id');
  if (oldId) {
    const existing = JSON.parse(localStorage.getItem(PLAYERS_KEY) || '[]');
    if (!existing.some(p => p.id === oldId)) {
      existing.push({ id: oldId, name: 'Investigator' });
      localStorage.setItem(PLAYERS_KEY, JSON.stringify(existing));
    }
    localStorage.removeItem('palme_player_id');
  }
})();

export default function App() {
  const { state, dispatch, loadData } = useGameState();
  const music = useMusic();
  const saveTimer = useRef(null);
  const [clueLogOpen, setClueLogOpen] = useState(false);
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [savedPlayers, setSavedPlayers] = useState(() => JSON.parse(localStorage.getItem(PLAYERS_KEY) || '[]'));
  const [notebookRevision, setNotebookRevision] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [needsApiKey, setNeedsApiKey] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [charactersTotal, setCharactersTotal] = useState(0);
  const [focusLocationId, setFocusLocationId] = useState(null);
  const focusTimer = useRef(null);
  const [finaleVerdict, setFinaleVerdict] = useState(null);
  const [caseSoFar, setCaseSoFar] = useState(null); // { recentClues, openLeads } | null
  const [caseRecap, setCaseRecap] = useState(null);
  const [seenEras, setSeenEras] = useState(null); // null until a player is loaded
  const [actInterstitial, setActInterstitial] = useState(null); // { era, eraLabel } | null

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  };

  // Load game data
  useEffect(() => {
    Promise.all([fetchLocations(), fetchClues(), fetchClueTypes(), fetchConfig()])
      .then(([locations, clues, clueTypes, config]) => {
        loadData(locations, clues, clueTypes);
        setCharactersTotal(Number(config.charactersTotal) || 0);
        if (!config.hasServerKey) {
          setNeedsApiKey(true);
          if (!getStoredApiKey()) setSettingsOpen(true);
        }
      })
      .catch(err => console.error('Failed to load game data:', err));
  }, [loadData]);

  // Switch music based on view and location
  useEffect(() => {
    const track = resolveTrack(state.currentView, state.activeLocationId);
    music.switchTrack(track);
  }, [state.currentView, state.activeLocationId]);

  // Play stinger when new clues are revealed
  const prevClueCount = useRef(state.revealedClueIds.length);
  useEffect(() => {
    if (state.revealedClueIds.length > prevClueCount.current) {
      music.playStinger();
    }
    prevClueCount.current = state.revealedClueIds.length;
  }, [state.revealedClueIds.length]);

  // Play slowed stinger (time-jump feel) when a new location unlocks during play.
  // The ref re-arms on player change so LOAD_PLAYER never triggers it.
  const prevLocationCount = useRef(null);
  useEffect(() => {
    prevLocationCount.current = null;
  }, [state.playerId]);
  useEffect(() => {
    if (prevLocationCount.current === null) {
      prevLocationCount.current = state.unlockedLocationIds.length;
      return;
    }
    if (state.unlockedLocationIds.length > prevLocationCount.current) {
      music.playStinger(0.7);
    }
    prevLocationCount.current = state.unlockedLocationIds.length;
  }, [state.unlockedLocationIds.length, state.playerId]);

  // Finale: when the finale clue is FIRST revealed during play, pull the player in after a beat.
  const finaleClueRevealed = state.clues.some(
    c => c.finale && state.revealedClueIds.includes(c.id)
  );
  const prevFinaleRevealed = useRef(null);
  useEffect(() => {
    prevFinaleRevealed.current = null;
  }, [state.playerId]);
  useEffect(() => {
    if (prevFinaleRevealed.current === null) {
      prevFinaleRevealed.current = finaleClueRevealed;
      return;
    }
    if (finaleClueRevealed && !prevFinaleRevealed.current) {
      prevFinaleRevealed.current = true;
      const t = setTimeout(() => dispatch({ type: 'SET_VIEW', view: 'finale' }), 2500);
      return () => clearTimeout(t);
    }
    prevFinaleRevealed.current = finaleClueRevealed;
  }, [finaleClueRevealed, state.playerId, dispatch]);

  // Load seen eras for this player (act interstitials shown once per era)
  useEffect(() => {
    if (!state.playerId) return;
    try {
      const stored = JSON.parse(localStorage.getItem(`agi_seen_eras_${state.playerId}`) || '[]');
      setSeenEras(Array.isArray(stored) ? stored : []);
    } catch {
      setSeenEras([]);
    }
  }, [state.playerId]);

  // Show act interstitial the first time the player enters a location of an unseen era
  useEffect(() => {
    if (!seenEras || state.currentView === 'intro' || !state.activeLocationId) return;
    const location = state.locations.find(l => l.id === state.activeLocationId);
    if (!location || location.era == null || seenEras.includes(location.era)) return;
    setActInterstitial({ era: location.era, eraLabel: location.eraLabel });
    const updated = [...seenEras, location.era];
    setSeenEras(updated);
    try {
      localStorage.setItem(`agi_seen_eras_${state.playerId}`, JSON.stringify(updated));
    } catch {
      // localStorage unavailable — interstitial may repeat next session, harmless
    }
  }, [state.activeLocationId, state.currentView, seenEras, state.locations, state.playerId]);

  // Travel: fly the map to a location (Travel buttons in notifications / Case So Far)
  const handleTravel = useCallback((locationId) => {
    dispatch({ type: 'SET_VIEW', view: 'map' });
    setFocusLocationId(locationId);
    clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => setFocusLocationId(null), 6000);
  }, [dispatch]);
  useEffect(() => () => clearTimeout(focusTimer.current), []);

  // Auto-save player state (debounced)
  useEffect(() => {
    if (!state.playerId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      savePlayerState(state.playerId, {
        unlockedLocations: state.unlockedLocationIds,
        revealedClues: state.revealedClueIds,
        revealedNames: state.revealedNames,
        characterSummaries: state.characterSummaries,
        visitedLocations: state.visitedLocationIds,
      }).catch(() => {});
    }, 1000);
  }, [state.playerId, state.unlockedLocationIds, state.revealedClueIds, state.revealedNames, state.characterSummaries, state.visitedLocationIds]);

  // Save conversation when it changes
  const handleSaveConversation = useCallback((characterId) => {
    if (!state.playerId) return;
    const msgs = state.conversations[characterId];
    if (msgs?.length) {
      saveConversation(state.playerId, characterId, msgs).catch(() => {});
    }
  }, [state.playerId, state.conversations]);

  // Handle start — create new player
  const handleStart = async (playerName) => {
    setSettingsOpen(false);
    music.switchTrack('intro');
    const player = await createPlayer(playerName);
    const updated = [...savedPlayers, { id: player.id, name: player.name }];
    localStorage.setItem(PLAYERS_KEY, JSON.stringify(updated));
    setSavedPlayers(updated);
    dispatch({ type: 'LOAD_PLAYER', player });
    dispatch({ type: 'SET_VIEW', view: 'map' });
  };

  // Build the "Case So Far" recap shown when resuming a game with progress
  const prepareCaseSoFar = (player) => {
    const revealed = player.revealedClues || [];
    if (revealed.length === 0 || state.clues.length === 0) return;

    const recentFull = revealed.slice(-3).map(id => {
      const clue = state.clues.find(c => c.id === id);
      return { title: clue?.title || id, type: clue?.type, description: clue?.description };
    });

    const unlocked = player.unlockedLocations || [];
    const visited = player.visitedLocations || [];
    const openLeads = [];
    for (const loc of state.locations) {
      if (openLeads.length >= 4) break;
      if (unlocked.includes(loc.id) && !visited.includes(loc.id)) {
        openLeads.push(`Travel to ${loc.name} — someone there is waiting to talk`);
      }
    }
    for (const loc of state.locations) {
      if (openLeads.length >= 4) break;
      if (unlocked.includes(loc.id) || !(loc.unlockedBy?.length > 0)) continue;
      const found = loc.unlockedBy.filter(id => revealed.includes(id)).length;
      if (found >= 1 && found < loc.unlockedBy.length) {
        openLeads.push(`A timeline coordinate is incomplete — ${found}/${loc.unlockedBy.length} leads found`);
      }
    }

    setCaseRecap(null);
    setCaseSoFar({
      recentClues: recentFull.map(({ title, type }) => ({ title, type })),
      openLeads,
    });
    // Fire-and-forget: the AI recap fills in when it resolves
    fetchRecap({
      recentClues: recentFull.map(({ title, description }) => ({ title, description })),
      openLeads,
    })
      .then(recap => { if (recap) setCaseRecap(recap); })
      .catch(() => {});
  };

  // Handle resume — load existing player
  const handleResume = async (playerId) => {
    setSettingsOpen(false);
    music.switchTrack('intro');
    const player = await loadPlayer(playerId);
    if (player) {
      dispatch({ type: 'LOAD_PLAYER', player });
      dispatch({ type: 'SET_VIEW', view: 'map' });
      prepareCaseSoFar(player);
    } else {
      // Player no longer exists in DB — remove from localStorage
      const updated = savedPlayers.filter(p => p.id !== playerId);
      localStorage.setItem(PLAYERS_KEY, JSON.stringify(updated));
      setSavedPlayers(updated);
    }
  };

  // Handle delete saved player
  const handleDeletePlayer = (playerId) => {
    const updated = savedPlayers.filter(p => p.id !== playerId);
    localStorage.setItem(PLAYERS_KEY, JSON.stringify(updated));
    setSavedPlayers(updated);
  };

  if (!state.dataLoaded) {
    return (
      <div className="h-screen flex items-center justify-center bg-noir-950">
        <p className="font-mono text-zinc-500 animate-pulse">Loading…</p>
      </div>
    );
  }

  if (state.currentView === 'intro') {
    return (
      <IntroScreen
        onStart={handleStart}
        onResume={handleResume}
        onDeletePlayer={handleDeletePlayer}
        savedPlayers={savedPlayers}
        music={music}
        needsApiKey={needsApiKey}
      />
    );
  }

  return (
    <div className="h-screen flex flex-col bg-noir-950 overflow-hidden">
      {/* Map is always rendered underneath */}
      <div className="flex-1 relative overflow-hidden">
        <GameMap
          locations={state.locations}
          unlockedLocationIds={state.unlockedLocationIds}
          revealedClueIds={state.revealedClueIds}
          visitedLocationIds={state.visitedLocationIds}
          focusLocationId={focusLocationId}
          onLocationClick={(id) => dispatch({ type: 'OPEN_LOCATION', locationId: id })}
        />

        {/* Side panels */}
        {state.currentView === 'location' && state.activeLocationId && (
          <LocationPanel
            locationId={state.activeLocationId}
            locations={state.locations}
            revealedNames={state.revealedNames}
            characterSummaries={state.characterSummaries}
            revealedClueIds={state.revealedClueIds}
            onBack={() => dispatch({ type: 'SET_VIEW', view: 'map' })}
            onCharacterClick={(id) => dispatch({ type: 'OPEN_CHAT', characterId: id })}
          />
        )}

        {state.currentView === 'chat' && state.activeCharacterId && (
          <ChatPanel
            characterId={state.activeCharacterId}
            locationId={state.activeLocationId}
            locations={state.locations}
            conversations={state.conversations}
            revealedClueIds={state.revealedClueIds}
            revealedNames={state.revealedNames}
            characterSummaries={state.characterSummaries}
            clues={state.clues}
            clueTypes={state.clueTypes}
            isLoading={state.isLoading}
            dispatch={dispatch}
            onSaveConversation={handleSaveConversation}
            onAddNote={async (characterName, message) => {
              setNotebookOpen(true);
              const note = await generateNote(characterName, message);
              if (note) {
                await appendNote(state.playerId, note);
                setNotebookRevision(r => r + 1);
              }
            }}
          />
        )}

        {/* Notebook */}
        <Notebook
          playerId={state.playerId}
          isOpen={notebookOpen}
          revision={notebookRevision}
          onClose={() => setNotebookOpen(false)}
        />

        {/* Clue log panel */}
        <ClueLog
          clues={state.clues}
          clueTypes={state.clueTypes}
          revealedClueIds={state.revealedClueIds}
          isOpen={clueLogOpen}
          onClose={() => setClueLogOpen(false)}
        />

        {/* Investigation board overlay */}
        {state.currentView === 'board' && (
          <InvestigationBoard
            clues={state.clues}
            clueTypes={state.clueTypes}
            revealedClueIds={state.revealedClueIds}
            conversations={state.conversations}
            revealedNames={state.revealedNames}
            characterSummaries={state.characterSummaries}
            locations={state.locations}
            playerId={state.playerId}
            onClose={() => dispatch({ type: 'SET_VIEW', view: 'map' })}
          />
        )}

        {/* Toast notifications */}
        <Notifications
          notifications={state.pendingNotifications}
          locations={state.locations}
          onDismiss={(id) => dispatch({ type: 'DISMISS_NOTIFICATION', notificationId: id })}
          onTravel={handleTravel}
        />

        {/* Finale — the Tabulator's interview */}
        {state.currentView === 'finale' && (
          <FinaleScreen
            revealedClueIds={state.revealedClueIds}
            onVerdict={(verdict) => {
              setFinaleVerdict(verdict || null);
              dispatch({ type: 'SET_VIEW', view: 'epilogue' });
            }}
            onExit={() => dispatch({ type: 'SET_VIEW', view: 'map' })}
          />
        )}

        {/* Epilogue — stats and verdict */}
        {state.currentView === 'epilogue' && (
          <EpilogueScreen
            stats={{
              cluesFound: state.revealedClueIds.length,
              cluesTotal: state.clues.length,
              locationsUnlocked: state.unlockedLocationIds.length,
              locationsTotal: state.locations.length,
              charactersMet: Object.keys(state.conversations).filter(
                id => (state.conversations[id] || []).some(m => m.role === 'user')
              ).length,
              charactersTotal,
            }}
            verdict={finaleVerdict}
            onContinue={() => dispatch({ type: 'SET_VIEW', view: 'map' })}
          />
        )}

        {/* The Case So Far — recap modal on resume */}
        {caseSoFar && (
          <CaseSoFar
            playerName={state.playerName}
            recentClues={caseSoFar.recentClues}
            openLeads={caseSoFar.openLeads}
            recap={caseRecap}
            onClose={() => setCaseSoFar(null)}
            onTravel={(locationId) => {
              setCaseSoFar(null);
              handleTravel(locationId);
            }}
          />
        )}

        {/* Act interstitial — first visit to an era */}
        {actInterstitial && (
          <ActInterstitial
            era={actInterstitial.era}
            eraLabel={actInterstitial.eraLabel}
            onDone={() => setActInterstitial(null)}
          />
        )}
      </div>

      {/* Desktop bottom toolbar — hidden on mobile */}
      <div className="hidden md:flex h-12 bg-noir-900 border-t border-noir-700 items-center justify-between px-4 shrink-0 z-30">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setClueLogOpen(o => !o)}
            className="font-mono text-xs text-zinc-400 hover:text-clue transition-colors
                       flex items-center gap-2 px-3 py-1.5 rounded border border-noir-700
                       hover:border-clue/30 bg-noir-800"
          >
            <span>Clues</span>
            {state.revealedClueIds.length > 0 && (
              <span className="bg-clue/20 text-clue px-1.5 py-0.5 rounded text-xs">
                {state.revealedClueIds.length}/{state.clues.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setNotebookOpen(o => !o)}
            className="font-mono text-xs text-zinc-400 hover:text-zinc-200 transition-colors
                       flex items-center gap-2 px-3 py-1.5 rounded border border-noir-700
                       hover:border-zinc-500 bg-noir-800"
          >
            Notes
          </button>
          {state.revealedClueIds.length >= 2 && (
            <button
              onClick={() => dispatch({ type: 'SET_VIEW', view: 'board' })}
              className="font-mono text-xs text-zinc-400 hover:text-blood transition-colors
                         flex items-center gap-2 px-3 py-1.5 rounded border border-noir-700
                         hover:border-blood/30 bg-noir-800"
            >
              Investigation Board
            </button>
          )}
          {finaleClueRevealed && ['map', 'location', 'chat', 'board'].includes(state.currentView) && (
            <button
              onClick={() => dispatch({ type: 'SET_VIEW', view: 'finale' })}
              className="font-mono text-xs text-clue hover:text-amber-300 transition-colors
                         flex items-center gap-2 px-3 py-1.5 rounded border border-clue/40
                         hover:border-clue bg-clue/10"
            >
              &#x29D7; The Tabulator awaits
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <MusicPlayer
            muted={music.muted}
            toggleMute={music.toggleMute}
            volume={music.volume}
            setVolume={music.setVolume}
            inline
          />
          <div className="relative">
            <button
              onClick={() => setSettingsOpen(o => !o)}
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
              title="Settings"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="8" cy="8" r="2.5" />
                <path d="M8 1v2M8 13v2M1 8h2M13 8h2M2.9 2.9l1.4 1.4M11.7 11.7l1.4 1.4M13.1 2.9l-1.4 1.4M4.3 11.7l-1.4 1.4" />
              </svg>
            </button>
            {settingsOpen && (
              <div className="absolute bottom-full right-0 mb-2 w-72 bg-noir-800 border border-noir-600 rounded-lg p-3 shadow-xl z-50">
                <ApiKeyInput compact />
              </div>
            )}
          </div>
          <button
            onClick={toggleFullscreen}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M5 1v4H1M11 1v4h4M5 15v-4H1M11 15v-4h4" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M1 5V1h4M11 1h4v4M1 11v4h4M15 11v4h-4" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile floating hamburger button — hidden during finale/epilogue */}
      {!['finale', 'epilogue'].includes(state.currentView) && (
      <div className="md:hidden fixed bottom-4 right-4 z-[70]">
        <button
          onClick={() => setMobileMenuOpen(o => !o)}
          className="w-12 h-12 rounded-full bg-noir-900 border border-noir-600 shadow-xl
                     flex items-center justify-center text-zinc-300 active:scale-95 transition-transform"
        >
          {mobileMenuOpen ? (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h14M3 10h14M3 14h14" />
            </svg>
          )}
          {!mobileMenuOpen && state.revealedClueIds.length > 0 && (
            <span className="absolute -top-1 -left-2 bg-clue text-noir-950 text-[9px] font-bold min-w-[20px] h-5 px-1 rounded-full flex items-center justify-center">
              {state.revealedClueIds.length}/{state.clues.length}
            </span>
          )}
        </button>
      </div>
      )}

      {/* Mobile slide-up menu */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-[65]" onClick={() => setMobileMenuOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="absolute bottom-0 left-0 right-0 bg-noir-900 border-t border-noir-700 rounded-t-2xl p-5 pb-8 space-y-3"
            onClick={(e) => e.stopPropagation()}
            style={{ animation: 'slideUp 0.2s ease-out' }}
          >
            <div className="w-10 h-1 bg-noir-600 rounded-full mx-auto mb-4" />

            <button
              onClick={() => { setClueLogOpen(o => !o); setMobileMenuOpen(false); }}
              className="w-full flex items-center justify-between px-4 py-3 rounded-lg
                         bg-noir-800 border border-noir-700 active:bg-noir-700"
            >
              <span className="font-mono text-sm text-zinc-300">Clues</span>
              {state.revealedClueIds.length > 0 && (
                <span className="bg-clue/20 text-clue px-2 py-0.5 rounded text-xs font-mono">
                  {state.revealedClueIds.length}/{state.clues.length}
                </span>
              )}
            </button>

            <button
              onClick={() => { setNotebookOpen(o => !o); setMobileMenuOpen(false); }}
              className="w-full flex items-center px-4 py-3 rounded-lg
                         bg-noir-800 border border-noir-700 active:bg-noir-700"
            >
              <span className="font-mono text-sm text-zinc-300">Notes</span>
            </button>

            {state.revealedClueIds.length >= 2 && (
              <button
                onClick={() => { dispatch({ type: 'SET_VIEW', view: 'board' }); setMobileMenuOpen(false); }}
                className="w-full flex items-center px-4 py-3 rounded-lg
                           bg-noir-800 border border-noir-700 active:bg-noir-700"
              >
                <span className="font-mono text-sm text-blood">Investigation Board</span>
              </button>
            )}

            {finaleClueRevealed && ['map', 'location', 'chat', 'board'].includes(state.currentView) && (
              <button
                onClick={() => { dispatch({ type: 'SET_VIEW', view: 'finale' }); setMobileMenuOpen(false); }}
                className="w-full flex items-center px-4 py-3 rounded-lg
                           bg-clue/10 border border-clue/40 active:bg-clue/20"
              >
                <span className="font-mono text-sm text-clue">&#x29D7; The Tabulator awaits</span>
              </button>
            )}

            <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-noir-800 border border-noir-700">
              <span className="font-mono text-sm text-zinc-300">Music</span>
              <MusicPlayer
                muted={music.muted}
                toggleMute={music.toggleMute}
                volume={music.volume}
                setVolume={music.setVolume}
                inline
              />
            </div>

            {state.currentView !== 'map' && (
              <button
                onClick={() => { dispatch({ type: 'SET_VIEW', view: 'map' }); setMobileMenuOpen(false); }}
                className="w-full flex items-center px-4 py-3 rounded-lg
                           bg-noir-800 border border-noir-700 active:bg-noir-700"
              >
                <span className="font-mono text-sm text-zinc-300">Back to the map</span>
              </button>
            )}

            <div className="px-4 py-3 rounded-lg bg-noir-800 border border-noir-700">
              <ApiKeyInput compact />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
