import { useEffect, useRef, useState, useCallback } from 'react';

const B = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

// Per-location soundtrack (Suno), keyed by location id. intro/map/board reuse fitting location tracks.
const TRACKS = {
  intro: B + '/music/openai_pioneer_2022.mp3',
  map: B + '/music/ias_princeton_1960.mp3',
  board: B + '/music/fhi_oxford_2014.mp3',
  manchester_lab_1950: B + '/music/manchester_lab_1950.mp3',
  ada_lovelace_london_1843: B + '/music/ada_lovelace_london_1843.mp3',
  bletchley_park_1941: B + '/music/bletchley_park_1941.mp3',
  bell_labs_1948: B + '/music/bell_labs_1948.mp3',
  dartmouth_1956: B + '/music/dartmouth_1956.mp3',
  cornell_aero_1958: B + '/music/cornell_aero_1958.mp3',
  mit_ai_lab_1969: B + '/music/mit_ai_lab_1969.mp3',
  royal_institution_1973: B + '/music/royal_institution_1973.mp3',
  symbolics_1987: B + '/music/symbolics_1987.mp3',
  bell_labs_holmdel_1989: B + '/music/bell_labs_holmdel_1989.mp3',
  openai_pioneer_2022: B + '/music/openai_pioneer_2022.mp3',
  utoronto_2006: B + '/music/utoronto_2006.mp3',
  krizhevsky_bedroom_2012: B + '/music/krizhevsky_bedroom_2012.mp3',
  four_seasons_seoul_2016: B + '/music/four_seasons_seoul_2016.mp3',
  long_beach_2017: B + '/music/long_beach_2017.mp3',
  anthropic_hq_2021: B + '/music/anthropic_hq_2021.mp3',
  fhi_oxford_2014: B + '/music/fhi_oxford_2014.mp3',
  miri_berkeley_2000: B + '/music/miri_berkeley_2000.mp3',
  ias_princeton_1960: B + '/music/ias_princeton_1960.mp3',
  dyson_swarm_2387: B + '/music/dyson_swarm_2387.mp3',
  // Act V bridge + finale/epilogue — files start as copies of older tracks; overwrite with
  // the Suno tracks specced in data/agi_soundtrack.md (entries 21-24) using these exact names
  aurora_campus_2045: B + '/music/aurora_campus_2045.mp3',
  lagrange_shipyard_2142: B + '/music/lagrange_shipyard_2142.mp3',
  finale: B + '/music/finale.mp3',
  epilogue: B + '/music/epilogue.mp3',
  xai_2023: B + '/music/xai_2023.mp3',
  google_brain_2017: B + '/music/google_brain_2017.mp3',
  nvidia_2012: B + '/music/nvidia_2012.mp3',
  mila_montreal_2018: B + '/music/mila_montreal_2018.mp3',
  meta_ai_2023: B + '/music/meta_ai_2023.mp3',
};

const STINGER = B + '/music/_stinger.mp3'; // clue-reveal stinger not generated yet; plays silently if absent
const FADE_MS = 1500;
const FADE_STEP = 50;

export function resolveTrack(view, locationId) {
  if (view === 'intro') return 'intro';
  if (view === 'board') return 'board';
  if (view === 'finale') return 'finale';
  if (view === 'epilogue') return 'epilogue';
  if ((view === 'chat' || view === 'location') && locationId && TRACKS[locationId]) {
    return locationId; // per-location track, keyed by location id
  }
  return 'map';
}

export function useMusic() {
  const audioRef = useRef(null);
  const stingerRef = useRef(null);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [volume, setVolume] = useState(0.3);
  const [muted, setMuted] = useState(false);
  const fadeInterval = useRef(null);

  // Init audio elements
  useEffect(() => {
    audioRef.current = new Audio();
    audioRef.current.loop = true;
    audioRef.current.volume = 0;
    stingerRef.current = new Audio(STINGER);
    stingerRef.current.volume = 0.4;
    return () => {
      audioRef.current?.pause();
      stingerRef.current?.pause();
      if (fadeInterval.current) clearInterval(fadeInterval.current);
    };
  }, []);

  // Update volume when muted/volume changes
  useEffect(() => {
    if (audioRef.current && currentTrack) {
      audioRef.current.volume = muted ? 0 : volume;
    }
  }, [muted, volume, currentTrack]);

  const switchTrack = useCallback((trackKey) => {
    if (trackKey === currentTrack) return;
    const audio = audioRef.current;
    if (!audio) return;

    const targetUrl = TRACKS[trackKey];
    if (!targetUrl) return;

    // Clear any existing fade
    if (fadeInterval.current) clearInterval(fadeInterval.current);

    if (!currentTrack) {
      // First play — just start
      audio.src = targetUrl;
      audio.volume = muted ? 0 : volume;
      audio.play().catch(() => {});
      setCurrentTrack(trackKey);
      return;
    }

    // Crossfade: fade out then switch
    const startVol = audio.volume;
    const steps = FADE_MS / FADE_STEP;
    let step = 0;

    fadeInterval.current = setInterval(() => {
      step++;
      audio.volume = Math.max(0, startVol * (1 - step / steps));

      if (step >= steps) {
        clearInterval(fadeInterval.current);
        fadeInterval.current = null;
        audio.src = targetUrl;
        audio.volume = 0;
        audio.play().catch(() => {});

        // Fade in
        let inStep = 0;
        const targetVol = muted ? 0 : volume;
        fadeInterval.current = setInterval(() => {
          inStep++;
          audio.volume = Math.min(targetVol, targetVol * (inStep / steps));
          if (inStep >= steps) {
            clearInterval(fadeInterval.current);
            fadeInterval.current = null;
          }
        }, FADE_STEP);
      }
    }, FADE_STEP);

    setCurrentTrack(trackKey);
  }, [currentTrack, volume, muted]);

  const playStinger = useCallback((rate = 1) => {
    const stinger = stingerRef.current;
    if (!stinger || muted) return;
    stinger.currentTime = 0;
    stinger.volume = 0.4;
    stinger.playbackRate = rate;
    if ('preservesPitch' in stinger) stinger.preservesPitch = false;
    stinger.play().catch(() => {});
  }, [muted]);

  const toggleMute = useCallback(() => setMuted(m => !m), []);

  return { switchTrack, playStinger, volume, setVolume, muted, toggleMute, currentTrack };
}
