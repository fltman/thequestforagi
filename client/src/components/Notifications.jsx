import { useEffect } from 'react';
import { ASSET_BASE } from '../lib/api';

export default function Notifications({ notifications, locations, onDismiss, onTravel }) {
  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 items-center">
      <style>{`
        @keyframes notif-scale-in {
          from { transform: scale(0.88); opacity: 0; }
          to   { transform: scale(1); opacity: 1; }
        }
      `}</style>
      {notifications.map(notif => {
        const kind = notif.kind || 'clue';
        if (kind === 'location') {
          return (
            <LocationCard
              key={notif.id}
              notification={notif}
              locations={locations}
              onDismiss={onDismiss}
              onTravel={onTravel}
            />
          );
        }
        if (kind === 'partial') {
          return <PartialToast key={notif.id} notification={notif} onDismiss={onDismiss} />;
        }
        if (kind === 'connection') {
          return <ConnectionToast key={notif.id} notification={notif} onDismiss={onDismiss} />;
        }
        return (
          <ClueToast
            key={notif.id}
            notification={notif}
            locations={locations}
            onDismiss={onDismiss}
          />
        );
      })}
    </div>
  );
}

function useAutoDismiss(id, onDismiss, ms) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(id), ms);
    return () => clearTimeout(timer);
  }, [id, onDismiss, ms]);
}

function ClueToast({ notification, locations, onDismiss }) {
  useAutoDismiss(notification.id, onDismiss, 4000);

  const location = notification.unlocksLocation
    ? locations.find(l => l.id === notification.unlocksLocation)
    : null;

  return (
    <div
      onClick={() => onDismiss(notification.id)}
      className="bg-noir-800/95 backdrop-blur-sm border border-clue/30 rounded-lg overflow-hidden
                 font-mono text-sm cursor-pointer hover:border-clue/50 transition-all
                 animate-slide-up shadow-lg shadow-black/50 max-w-sm flex items-center gap-3"
    >
      <img
        src={`${ASSET_BASE}/images/clues/${notification.clueId}.jpg`}
        alt=""
        className="w-16 h-16 object-cover shrink-0"
        onError={(e) => { e.target.style.display = 'none'; }}
      />
      <div className="py-3 pr-4">
        <div className="text-clue flex items-center gap-2">
          <span className="text-base">&#x1f50d;</span>
          <span>New clue: {notification.title}</span>
        </div>
        {location && (
          <div className="text-zinc-500 text-xs mt-1">
            New location on the map: {location.name}
          </div>
        )}
      </div>
    </div>
  );
}

function LocationCard({ notification, locations, onDismiss, onTravel }) {
  const location = notification.locationId
    ? locations.find(l => l.id === notification.locationId)
    : null;
  const locationName = notification.locationName || location?.name || notification.title;

  return (
    <div
      className="bg-noir-900/95 backdrop-blur-sm border-2 border-clue rounded-lg
                 font-mono text-sm shadow-lg shadow-black/50 max-w-sm w-80"
      style={{ animation: 'notif-scale-in 0.3s ease-out' }}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="text-clue text-[10px] uppercase tracking-widest">
            Timeline node discovered
          </div>
          <button
            onClick={() => onDismiss(notification.id)}
            className="text-zinc-500 hover:text-zinc-300 leading-none shrink-0"
            aria-label="Dismiss"
          >
            &#x2715;
          </button>
        </div>
        <div className="font-serif text-lg text-white mt-1">{locationName}</div>
        <button
          onClick={() => {
            if (onTravel && notification.locationId) onTravel(notification.locationId);
            onDismiss(notification.id);
          }}
          className="mt-3 w-full bg-clue/20 hover:bg-clue/30 border border-clue/50
                     text-clue rounded px-3 py-2 text-xs uppercase tracking-widest transition-all"
        >
          Travel there
        </button>
      </div>
    </div>
  );
}

function PartialToast({ notification, onDismiss }) {
  useAutoDismiss(notification.id, onDismiss, 5000);

  const found = notification.progress?.found ?? 0;
  const total = notification.progress?.total ?? 0;

  return (
    <div
      onClick={() => onDismiss(notification.id)}
      className="bg-noir-800/95 backdrop-blur-sm border border-dashed border-clue/50 rounded-lg
                 font-mono text-xs cursor-pointer hover:border-clue/70 transition-all
                 animate-slide-up shadow-lg shadow-black/50 max-w-sm px-4 py-3 text-zinc-300"
    >
      <span className="text-clue mr-2">&#x29D7;</span>
      Timeline coordinate incomplete &mdash; {found}/{total} leads found
    </div>
  );
}

function ConnectionToast({ notification, onDismiss }) {
  useAutoDismiss(notification.id, onDismiss, 6000);

  const linkedTitle = notification.linkedTitles?.[0] || '';

  return (
    <div
      onClick={() => onDismiss(notification.id)}
      className="bg-noir-800/95 backdrop-blur-sm border border-contradiction/50 rounded-lg
                 font-mono text-xs cursor-pointer hover:border-contradiction/70 transition-all
                 animate-slide-up shadow-lg shadow-black/50 max-w-sm px-4 py-3"
      style={{ color: '#a78bfa' }}
    >
      <span className="mr-2">&#x26A1;</span>
      Connection discovered: {notification.title} &#x2194; {linkedTitle}
    </div>
  );
}
