import { useReducer, useCallback, useRef } from 'react';
import { savePlayerState, saveConversation } from '../lib/api';

const initialState = {
  currentView: 'intro', // intro | map | location | chat | board | finale | epilogue
  locations: [],
  clues: [],
  clueTypes: [],
  unlockedLocationIds: [],
  revealedClueIds: [],
  visitedLocationIds: [],
  revealedNames: [], // character IDs whose real name is known
  characterSummaries: {}, // { characterId: "summary text" }
  activeLocationId: null,
  activeCharacterId: null,
  conversations: {}, // { characterId: [{ role, content }] }
  pendingNotifications: [],
  isLoading: false,
  dataLoaded: false,
  playerId: null,
  playerName: null,
};

function gameReducer(state, action) {
  switch (action.type) {
    case 'LOAD_DATA': {
      const defaultUnlocked = action.locations
        .filter(l => l.unlockedByDefault)
        .map(l => l.id);
      return {
        ...state,
        locations: action.locations,
        clues: action.clues,
        clueTypes: action.clueTypes,
        unlockedLocationIds: defaultUnlocked,
        dataLoaded: true,
      };
    }

    case 'LOAD_PLAYER': {
      return {
        ...state,
        playerId: action.player.id,
        playerName: action.player.name,
        unlockedLocationIds: action.player.unlockedLocations,
        revealedClueIds: action.player.revealedClues,
        visitedLocationIds: action.player.visitedLocations || [],
        revealedNames: action.player.revealedNames || [],
        characterSummaries: action.player.characterSummaries || {},
        conversations: action.player.conversations || {},
      };
    }

    case 'SET_VIEW':
      return { ...state, currentView: action.view };

    case 'OPEN_LOCATION':
      return {
        ...state,
        currentView: 'location',
        activeLocationId: action.locationId,
        activeCharacterId: null,
        visitedLocationIds: state.visitedLocationIds.includes(action.locationId)
          ? state.visitedLocationIds
          : [...state.visitedLocationIds, action.locationId],
      };

    case 'OPEN_CHAT':
      return {
        ...state,
        currentView: 'chat',
        activeCharacterId: action.characterId,
      };

    case 'ADD_MESSAGE': {
      const charId = action.characterId;
      const prev = state.conversations[charId] || [];
      const message = { role: action.role, content: action.content };
      if (action.clues) message.clues = action.clues;
      return {
        ...state,
        conversations: {
          ...state.conversations,
          [charId]: [...prev, message],
        },
      };
    }

    case 'SET_MESSAGE_CLUES': {
      const msgs = state.conversations[action.characterId];
      if (!msgs || action.index < 0 || action.index >= msgs.length) return state;
      return {
        ...state,
        conversations: {
          ...state.conversations,
          [action.characterId]: msgs.map((m, i) =>
            i === action.index ? { ...m, clues: action.clueIds } : m
          ),
        },
      };
    }

    case 'SET_LOADING':
      return { ...state, isLoading: action.loading };

    case 'REVEAL_NAME': {
      if (state.revealedNames.includes(action.characterId)) return state;
      return {
        ...state,
        revealedNames: [...state.revealedNames, action.characterId],
      };
    }

    case 'SET_CHARACTER_SUMMARY': {
      return {
        ...state,
        characterSummaries: {
          ...state.characterSummaries,
          [action.characterId]: action.summary,
        },
      };
    }

    case 'REVEAL_CLUES': {
      const newClueIds = action.clueIds.filter(
        id => !state.revealedClueIds.includes(id)
      );
      if (newClueIds.length === 0) return state;

      const nextRevealed = [...state.revealedClueIds, ...newClueIds];
      const now = Date.now();

      // Location unlocks — ALL-of gating via unlockedBy, legacy fallback via clue.unlocksLocation
      const newLocationIds = [];
      const locationNotifications = [];
      for (const location of state.locations) {
        if (state.unlockedLocationIds.includes(location.id)) continue;

        if (location.unlockedBy?.length > 0) {
          const prevFound = location.unlockedBy.filter(id => state.revealedClueIds.includes(id)).length;
          const found = location.unlockedBy.filter(id => nextRevealed.includes(id)).length;
          if (found === location.unlockedBy.length) {
            newLocationIds.push(location.id);
            locationNotifications.push({
              id: `${location.id}-${now}-location`,
              kind: 'location',
              locationId: location.id,
              locationName: location.name,
              title: location.name,
            });
          } else if (found > prevFound && found >= 1) {
            // Partial progress on a multi-clue gate — no location name (no spoilers)
            locationNotifications.push({
              id: `${location.id}-${now}-partial`,
              kind: 'partial',
              title: 'Timeline coordinate',
              progress: { found, total: location.unlockedBy.length },
            });
          }
        } else {
          // Legacy single-clue gate
          const unlockedNow = newClueIds.some(id => {
            const clue = state.clues.find(c => c.id === id);
            return clue?.unlocksLocation === location.id;
          });
          if (unlockedNow) {
            newLocationIds.push(location.id);
            locationNotifications.push({
              id: `${location.id}-${now}-location`,
              kind: 'location',
              locationId: location.id,
              locationName: location.name,
              title: location.name,
            });
          }
        }
      }

      // Per-clue notifications + connection discoveries
      const clueNotifications = [];
      const connectionNotifications = [];
      newClueIds.forEach((id, index) => {
        const clue = state.clues.find(c => c.id === id);
        clueNotifications.push({
          id: `${id}-${now}-clue`,
          kind: 'clue',
          clueId: id,
          title: clue?.title || id,
          type: clue?.type,
          unlocksLocation:
            clue?.unlocksLocation && newLocationIds.includes(clue.unlocksLocation)
              ? clue.unlocksLocation
              : undefined,
        });

        const linkedRevealed = (clue?.linkedClues || []).filter(linkedId => {
          if (state.revealedClueIds.includes(linkedId)) return true;
          const earlier = newClueIds.indexOf(linkedId);
          return earlier !== -1 && earlier < index;
        });
        if (linkedRevealed.length > 0) {
          connectionNotifications.push({
            id: `${id}-${now}-connection`,
            kind: 'connection',
            title: clue?.title || id,
            linkedTitles: linkedRevealed.map(linkedId => {
              const linked = state.clues.find(c => c.id === linkedId);
              return linked?.title || linkedId;
            }),
          });
        }
      });

      return {
        ...state,
        revealedClueIds: nextRevealed,
        unlockedLocationIds: [...state.unlockedLocationIds, ...newLocationIds],
        pendingNotifications: [
          ...state.pendingNotifications,
          ...clueNotifications,
          ...connectionNotifications,
          ...locationNotifications,
        ],
      };
    }

    case 'DISMISS_NOTIFICATION':
      return {
        ...state,
        pendingNotifications: state.pendingNotifications.filter(
          n => n.id !== action.notificationId
        ),
      };

    default:
      return state;
  }
}

export function useGameState() {
  const [state, dispatch] = useReducer(gameReducer, initialState);
  const saveTimerRef = useRef(null);

  const loadData = useCallback((locations, clues, clueTypes) => {
    dispatch({ type: 'LOAD_DATA', locations, clues, clueTypes });
  }, []);

  // Debounced auto-save to server
  const scheduleSave = useCallback((currentState) => {
    if (!currentState.playerId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      savePlayerState(currentState.playerId, {
        unlockedLocations: currentState.unlockedLocationIds,
        revealedClues: currentState.revealedClueIds,
        revealedNames: currentState.revealedNames,
        characterSummaries: currentState.characterSummaries,
        visitedLocations: currentState.visitedLocationIds,
      }).catch(() => {});
    }, 1000);
  }, []);

  return { state, dispatch, loadData, scheduleSave };
}
