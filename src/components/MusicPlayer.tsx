import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Disc3, Music2, Pause, Play, Plus, Shuffle, SkipBack, SkipForward, Square, Trash2, Upload, Volume2, VolumeX, X } from 'lucide-react';
import { PUBLIC_PLAYLIST } from '../music/playlist';
import { addDeviceTracks, chooseAudioFiles, readDeviceTracks, removeDeviceTrack, type StoredDeviceTrack } from '../music/library';
import {
  connectMusicSync,
  createAdditionalDeviceCode,
  createMusicSyncClientId,
  createMusicSyncCode,
  getMusicSyncCode,
  isMusicSyncConfigured,
  parseMusicSyncCode,
  readMusicSyncCode,
  saveMusicSyncCode,
  type MusicSyncConnection,
  type MusicSyncLibraryTrack,
  type MusicSyncPairing,
} from '../music/musicSync';

const PLAYER_KEY = 'eco-starter:player';
const PRIVATE_URLS_KEY = 'eco-starter:private-urls';

interface PlayerTrack {
  id: string;
  title: string;
  artist: string;
  src: string;
  kind: 'public' | 'device' | 'private-url' | 'shared';
}

interface SavedPlayer {
  trackId: string;
  currentTime: number;
  wasPlaying: boolean;
}

interface PrivateUrlTrack {
  id: string;
  title: string;
  artist: string;
  audioUrl: string;
}

interface AudioPowerGraph {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  bass: BiquadFilterNode;
  clarity: BiquadFilterNode;
  highShelf: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  limiter: DynamicsCompressorNode;
}

function canEnhanceTrack(track: PlayerTrack | undefined) {
  if (!track) return false;
  if (track.kind === 'device') return true;
  try {
    return new URL(track.src, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

function createAudioPowerGraph(element: HTMLAudioElement, gainLevel: number, bassLevel: number): AudioPowerGraph {
  const context = new AudioContext();
  let source: MediaElementAudioSourceNode | null = null;
  const boost = Math.max(0, Math.min(1, (gainLevel - 1) / 9));
  try {
    source = context.createMediaElementSource(element);
    const bass = context.createBiquadFilter();
    bass.type = 'lowshelf';
    bass.frequency.value = 110;
    bass.gain.value = bassLevel;
    const clarity = context.createBiquadFilter();
    clarity.type = 'peaking';
    clarity.frequency.value = 2800;
    clarity.Q.value = 0.9;
    clarity.gain.value = 2 * boost;
    const highShelf = context.createBiquadFilter();
    highShelf.type = 'highshelf';
    highShelf.frequency.value = 7500;
    highShelf.gain.value = boost;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18 * boost;
    compressor.knee.value = 12 * boost;
    compressor.ratio.value = 1 + 5 * boost;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    const gain = context.createGain();
    gain.gain.value = gainLevel;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -1.5 * boost;
    limiter.knee.value = 0;
    limiter.ratio.value = 1 + 19 * boost;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.08;
    source.connect(bass);
    bass.connect(clarity);
    clarity.connect(highShelf);
    highShelf.connect(compressor);
    compressor.connect(gain);
    gain.connect(limiter);
    limiter.connect(context.destination);
    return { context, source, gain, bass, clarity, highShelf, compressor, limiter };
  } catch (error) {
    if (source) source.disconnect();
    void context.close();
    throw error;
  }
}

function updateAudioPowerGraph(graph: AudioPowerGraph, gainLevel: number, bassLevel: number) {
  const boost = Math.max(0, Math.min(1, (gainLevel - 1) / 9));
  const now = graph.context.currentTime;
  graph.gain.gain.setTargetAtTime(gainLevel, now, 0.04);
  graph.bass.gain.setTargetAtTime(bassLevel, now, 0.04);
  graph.clarity.gain.setTargetAtTime(2 * boost, now, 0.04);
  graph.highShelf.gain.setTargetAtTime(boost, now, 0.04);
  graph.compressor.threshold.setTargetAtTime(-18 * boost, now, 0.04);
  graph.compressor.knee.setTargetAtTime(12 * boost, now, 0.04);
  graph.compressor.ratio.setTargetAtTime(1 + 5 * boost, now, 0.04);
  graph.limiter.threshold.setTargetAtTime(-1.5 * boost, now, 0.04);
  graph.limiter.ratio.setTargetAtTime(1 + 19 * boost, now, 0.04);
}

function readSavedPlayer(): SavedPlayer | null {
  try {
    const saved = window.localStorage.getItem(PLAYER_KEY);
    if (!saved) return null;
    const value = JSON.parse(saved) as Partial<SavedPlayer>;
    if (
      typeof value.trackId !== 'string' ||
      typeof value.currentTime !== 'number' ||
      !Number.isFinite(value.currentTime)
    ) return null;
    return { trackId: value.trackId, currentTime: Math.max(0, value.currentTime), wasPlaying: value.wasPlaying === true };
  } catch {
    return null;
  }
}

function readPrivateUrls(): PrivateUrlTrack[] {
  try {
    const saved = window.localStorage.getItem(PRIVATE_URLS_KEY);
    if (!saved) return [];
    const value: unknown = JSON.parse(saved);
    if (!Array.isArray(value)) return [];
    return value.filter((track): track is PrivateUrlTrack =>
      typeof track?.id === 'string' &&
      typeof track?.title === 'string' &&
      typeof track?.artist === 'string' &&
      typeof track?.audioUrl === 'string',
    );
  } catch {
    return [];
  }
}

function savePlayer(trackId: string, currentTime: number, wasPlaying: boolean) {
  try {
    window.localStorage.setItem(PLAYER_KEY, JSON.stringify({ trackId, currentTime, wasPlaying }));
  } catch {
    throw new Error('Your browser could not save the playback position.');
  }
}

function hasAudibleVideo() {
  return Array.from(document.querySelectorAll('video')).some(
    (video) => !video.paused && !video.ended && !video.muted && video.volume > 0,
  );
}

export default function MusicPlayer() {
  if (!PUBLIC_PLAYLIST.length) return null;
  return <ConfiguredMusicPlayer />;
}

function ConfiguredMusicPlayer() {
  const audio = useRef<HTMLAudioElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const restoredTime = useRef(0);
  const restoredTrack = useRef('');
  const shouldAutoplayOnLoad = useRef(true);
  const playAfterLoad = useRef(false);
  const nativeFallbackPending = useRef(false);
  const playTrackRef = useRef<() => void>(() => {});
  const pausedByVideoRef = useRef(false);
  const activeTrackRef = useRef<PlayerTrack | undefined>(undefined);
  const audioPower = useRef<AudioPowerGraph | null>(null);
  const objectUrls = useRef(new Set<string>());
  const lastSavedSecond = useRef(-1);
  const [deviceTracks, setDeviceTracks] = useState<(StoredDeviceTrack & { src: string })[]>([]);
  const [privateUrls, setPrivateUrls] = useState<PrivateUrlTrack[]>([]);
  const [sharedTracks, setSharedTracks] = useState<MusicSyncLibraryTrack[]>([]);
  const [activeId, setActiveId] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [needsResume, setNeedsResume] = useState(false);
  const [volumePercent, setVolumePercent] = useState(100);
  const [isMuted, setIsMuted] = useState(false);
  const [syncPairing, setSyncPairing] = useState<MusicSyncPairing | null>(readMusicSyncCode);
  const [pendingPairing, setPendingPairing] = useState<MusicSyncPairing | null>(null);
  const [syncCodeInput, setSyncCodeInput] = useState('');
  const [additionalDeviceCode, setAdditionalDeviceCode] = useState('');
  const [syncConnectionStatus, setSyncConnectionStatus] = useState<'unconfigured' | 'connecting' | 'connected' | 'disconnected'>('unconfigured');
  const [syncUploadStatus, setSyncUploadStatus] = useState<'idle' | 'uploading' | 'ready' | 'error'>('idle');
  const [syncStateReady, setSyncStateReady] = useState(false);
  const [syncClientId] = useState(createMusicSyncClientId);
  const syncConnection = useRef<MusicSyncConnection | null>(null);
  const syncLeaderRef = useRef(false);
  const syncOwnerRef = useRef<string | null>(null);
  const playFromSyncRef = useRef<() => void>(() => {});
  const [useNativePlayback, setUseNativePlayback] = useState(false);
  const [isShuffleEnabled, setIsShuffleEnabled] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [urlTitle, setUrlTitle] = useState('');
  const [urlValue, setUrlValue] = useState('');
  const [progress, setProgress] = useState(0);

  const tracks = useMemo<PlayerTrack[]>(() => [
    ...PUBLIC_PLAYLIST.map((track) => ({ ...track, src: track.audioUrl, kind: 'public' as const })),
    ...privateUrls.map((track) => ({ id: track.id, title: track.title, artist: track.artist, src: track.audioUrl, kind: 'private-url' as const })),
    ...deviceTracks.map((track) => ({ id: track.id, title: track.title, artist: track.artist, src: track.src, kind: 'device' as const })),
    ...sharedTracks
      .filter((track) => !deviceTracks.some((local) => local.id === track.id) && !privateUrls.some((local) => local.id === track.id))
      .map((track) => ({ id: track.id, title: track.title, artist: track.artist, src: track.audioUrl, kind: 'shared' as const })),
  ], [deviceTracks, privateUrls, sharedTracks]);
  const activeTrack = tracks.find((track) => track.id === activeId) ?? tracks[0];
  const activeIndex = Math.max(0, tracks.findIndex((track) => track.id === activeTrack?.id));
  const enhancementSupported = canEnhanceTrack(activeTrack);
  const audioProcessingEnabled = enhancementSupported && !useNativePlayback;
  const volumeBoost = Math.max(0, Math.min(1, (volumePercent - 100) / 100));
  const volumeGain = 1 + volumeBoost * 9;
  const volumeBass = volumeBoost * 18;
  activeTrackRef.current = activeTrack;

  const switchToNativePlayback = useCallback(() => {
    const element = audio.current;
    if (element && activeTrack) {
      restoredTrack.current = activeTrack.id;
      restoredTime.current = Number.isFinite(element.currentTime) ? element.currentTime : 0;
      playAfterLoad.current = playAfterLoad.current || !element.paused;
    }
    nativeFallbackPending.current = true;
    setUseNativePlayback(true);
    if (element) element.volume = Math.min(volumePercent, 100) / 100;
    setMessage('Volume boost is unavailable for this track; standard volume is available.');
  }, [activeTrack, volumePercent]);

  const switchToEnhancedPlayback = useCallback(() => {
    const element = audio.current;
    if (element && activeTrack) {
      restoredTrack.current = activeTrack.id;
      restoredTime.current = Number.isFinite(element.currentTime) ? element.currentTime : 0;
      playAfterLoad.current = !element.paused;
    }
    setUseNativePlayback(false);
    setMessage('');
  }, [activeTrack]);

  const enableAudioEnhancement = useCallback((gainLevel = volumeGain, bassLevel = volumeBass) => {
    const element = audio.current;
    if (!element || !activeTrack || useNativePlayback) return false;
    if (!canEnhanceTrack(activeTrack)) {
      setMessage('Volume boost is unavailable for this track; standard volume is available.');
      return false;
    }
    try {
      let graph = audioPower.current;
      if (!graph) {
        graph = createAudioPowerGraph(element, gainLevel, bassLevel);
        audioPower.current = graph;
        const context = graph.context;
        context.addEventListener('statechange', () => {
          if (context.state !== 'running' && context.state !== 'closed' && !element.paused && document.visibilityState === 'visible') {
            void context.resume().then(() => {
              if (context.state !== 'running') switchToNativePlayback();
            }).catch(switchToNativePlayback);
          }
        });
      }
      updateAudioPowerGraph(graph, gainLevel, bassLevel);
      const context = graph.context;
      if (context.state !== 'running') {
        void context.resume().then(() => {
          if (context.state !== 'running') switchToNativePlayback();
        }).catch(switchToNativePlayback);
      }
      setMessage('');
      return true;
    } catch {
      const graph = audioPower.current;
      if (graph) {
        graph.source.disconnect();
        void graph.context.close();
        audioPower.current = null;
      }
      switchToNativePlayback();
      return false;
    }
  }, [activeTrack, switchToNativePlayback, useNativePlayback, volumeBass, volumeGain]);

  useEffect(() => {
    if (enhancementSupported || volumePercent <= 100) return;
    setVolumePercent(100);
    if (audio.current) audio.current.volume = 1;
  }, [enhancementSupported, volumePercent]);

  useEffect(() => {
    if (audioProcessingEnabled) return;
    const graph = audioPower.current;
    if (!graph) return;
    graph.source.disconnect();
    audioPower.current = null;
    void graph.context.close();
  }, [audioProcessingEnabled]);

  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    element.volume = Math.min(volumePercent, 100) / 100;
    element.muted = isMuted;
    if (!syncLeaderRef.current) return;
    if (volumePercent > 100 && audioProcessingEnabled) {
      enableAudioEnhancement(volumeGain, volumeBass);
    } else if (audioPower.current) {
      enableAudioEnhancement(1, 0);
    }
  }, [audioProcessingEnabled, enableAudioEnhancement, isMuted, volumeBass, volumeGain, volumePercent]);

  useEffect(() => () => {
    const graph = audioPower.current;
    if (!graph) return;
    graph.source.disconnect();
    void graph.context.close();
    audioPower.current = null;
  }, []);

  useEffect(() => {
    let active = true;
    const loadLibrary = async () => {
      try {
        const [storedTracks] = await Promise.all([readDeviceTracks()]);
        if (!active) return;
        const loadedTracks = storedTracks.map((track) => {
          const src = URL.createObjectURL(track.file);
          objectUrls.current.add(src);
          return { ...track, src };
        });
        setDeviceTracks(loadedTracks);
        setPrivateUrls(readPrivateUrls());
        const saved = readSavedPlayer();
        restoredTrack.current = saved?.trackId ?? '';
        restoredTime.current = saved?.currentTime ?? 0;
        shouldAutoplayOnLoad.current = true;
        setNeedsResume(Boolean(saved?.wasPlaying));
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : 'The music library could not be loaded.');
      } finally {
        if (active) setIsReady(true);
      }
    };
    void loadLibrary();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isReady || !tracks.length) return;
    const restored = tracks.find((track) => track.id === restoredTrack.current);
    setActiveId((current) => current || restored?.id || tracks[0].id);
  }, [isReady, tracks]);

  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    element.pause();
    element.removeAttribute('src');
    element.load();
    setIsPlaying(false);
    setProgress(0);
    if (playAfterLoad.current && activeTrack) {
      playAfterLoad.current = false;
      nativeFallbackPending.current = false;
      window.setTimeout(() => playTrackRef.current(), 0);
    } else {
      nativeFallbackPending.current = false;
    }
  }, [activeTrack?.id, activeTrack?.src, audioProcessingEnabled]);

  useEffect(() => () => {
    objectUrls.current.forEach((src) => URL.revokeObjectURL(src));
    objectUrls.current.clear();
  }, []);

  useEffect(() => {
    const saveBeforeLeaving = () => {
      const element = audio.current;
      const track = activeTrackRef.current;
      if (!element || !track) return;
      try {
        savePlayer(track.id, element.currentTime, !element.paused);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'The playback position could not be saved.');
      }
    };
    const saveWhenHidden = () => {
      if (document.visibilityState === 'hidden') saveBeforeLeaving();
    };
    window.addEventListener('pagehide', saveBeforeLeaving);
    window.addEventListener('beforeunload', saveBeforeLeaving);
    document.addEventListener('visibilitychange', saveWhenHidden);
    return () => {
      window.removeEventListener('pagehide', saveBeforeLeaving);
      window.removeEventListener('beforeunload', saveBeforeLeaving);
      document.removeEventListener('visibilitychange', saveWhenHidden);
    };
  }, []);

  const selectTrack = useCallback((index: number, continuePlaying = false) => {
    const next = tracks[index];
    if (!next) return;
    try {
      savePlayer(next.id, 0, continuePlaying);
      restoredTrack.current = next.id;
      restoredTime.current = 0;
      playAfterLoad.current = continuePlaying;
      setNeedsResume(false);
      setActiveId(next.id);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The selected track could not be saved.');
    }
  }, [tracks]);

  const selectNextTrack = useCallback((continuePlaying = false) => {
    if (!tracks.length) return;
    let nextIndex = (activeIndex + 1) % tracks.length;
    if (isShuffleEnabled && tracks.length > 1) {
      const randomIndex = Math.floor(Math.random() * (tracks.length - 1));
      nextIndex = randomIndex >= activeIndex ? randomIndex + 1 : randomIndex;
    }
    selectTrack(nextIndex, continuePlaying);
  }, [activeIndex, isShuffleEnabled, selectTrack, tracks.length]);

  const play = useCallback(async (enhance = false, fromSync = false) => {
    const element = audio.current;
    if (!element || !activeTrack) return;
    if (hasAudibleVideo()) {
      pausedByVideoRef.current = true;
      setMessage('Music paused while a video has sound. Mute or pause the video to resume music.');
      return;
    }
    if (syncPairing && isMusicSyncConfigured()) {
      const connection = syncConnection.current;
      if (!connection) {
        setMessage('Connecting to shared music controls. Try again when sync is connected.');
        return;
      }
      if (!syncLeaderRef.current) {
        try {
          const lease = await connection.lease('acquire');
          if (!lease.granted) {
            syncOwnerRef.current = lease.ownerClientId;
            setMessage('Music is already active in another client on this device. Use the controls here to control all paired players.');
            return;
          }
          syncLeaderRef.current = true;
          syncOwnerRef.current = syncClientId;
        } catch (error) {
          setMessage(error instanceof Error ? `Music sync could not acquire playback: ${error.message}` : 'Music sync could not acquire playback.');
          return;
        }
      }
    }
    if (enhance && volumePercent > 100 && enhancementSupported && !useNativePlayback) {
      playAfterLoad.current = true;
    }
    const enhancementStarted = enhance && volumePercent > 100 && enableAudioEnhancement();
    if (enhance && volumePercent > 100 && !enhancementStarted && enhancementSupported && !useNativePlayback) {
      playAfterLoad.current = true;
      return;
    }
    try {
      if (element.getAttribute('src') !== activeTrack.src || element.readyState < 1) {
        const metadataLoaded = new Promise<void>((resolve, reject) => {
          let settled = false;
          const cleanUp = () => {
            element.removeEventListener('loadedmetadata', onLoaded);
            element.removeEventListener('error', onError);
          };
          const onLoaded = () => {
            if (settled) return;
            settled = true;
            cleanUp();
            if (restoredTrack.current === activeTrack.id && restoredTime.current > 0 && Number.isFinite(element.duration)) {
              element.currentTime = Math.min(restoredTime.current, Math.max(0, element.duration - 1));
            }
            restoredTrack.current = '';
            restoredTime.current = 0;
            resolve();
          };
          const onError = () => {
            if (settled) return;
            settled = true;
            cleanUp();
            reject(new Error('The audio metadata could not be loaded.'));
          };
          element.addEventListener('loadedmetadata', onLoaded);
          element.addEventListener('error', onError);
          element.src = activeTrack.src;
          element.load();
          if (element.readyState >= 1) onLoaded();
        });
        const playbackStarted = element.play();
        await Promise.all([metadataLoaded, playbackStarted]);
      } else {
        await element.play();
      }
      setIsPlaying(true);
      setNeedsResume(false);
      setMessage('');
      if (!fromSync && syncConnection.current) {
        void syncConnection.current.sendCommand({ type: 'play' }).catch((error: unknown) => {
          setMessage(error instanceof Error ? `Music sync could not broadcast playback: ${error.message}` : 'Music sync could not broadcast playback.');
        });
      }
    } catch (error) {
      const autoplayBlocked = error instanceof Error && error.name === 'NotAllowedError';
      setNeedsResume(autoplayBlocked);
      setMessage(autoplayBlocked
        ? 'Autoplay was blocked. Click or tap anywhere to start music.'
        : activeTrack.kind === 'shared'
          ? 'This shared audio could not be loaded. Confirm the original site finished uploading it, and that your browser supports its format.'
          : 'This track could not be played. Check that the audio file or URL is available.');
      if (syncLeaderRef.current && syncConnection.current) {
        syncLeaderRef.current = false;
        syncOwnerRef.current = null;
        void syncConnection.current.lease('release').catch(() => {
          setMessage('Playback failed and its sync lock could not be released yet.');
        });
      }
    }
  }, [activeTrack, enableAudioEnhancement, enhancementSupported, syncClientId, syncPairing, useNativePlayback, volumePercent]);
  playTrackRef.current = () => { void play(true); };
  playFromSyncRef.current = () => { void play(true, true); };

  useEffect(() => {
    if (!syncPairing) {
      syncConnection.current = null;
      syncLeaderRef.current = false;
      syncOwnerRef.current = null;
      setSyncConnectionStatus(isMusicSyncConfigured() ? 'disconnected' : 'unconfigured');
      setSyncStateReady(false);
      return;
    }
    if (!isMusicSyncConfigured()) {
      setSyncConnectionStatus('unconfigured');
      setSyncStateReady(false);
      setMessage('Pairing is saved, but the shared music relay is not configured in this site build.');
      return;
    }

    setSyncConnectionStatus('connecting');
    setSyncStateReady(false);
    const connection = connectMusicSync(syncPairing, syncClientId, {
      onConnectionChange: (connected) => {
        setSyncConnectionStatus(connected ? 'connected' : 'disconnected');
        if (connected) {
          void syncConnection.current?.readLibrary().then(setSharedTracks).catch((error: unknown) => {
            setMessage(error instanceof Error ? `The shared library could not be loaded: ${error.message}` : 'The shared library could not be loaded.');
          });
        }
      },
      onState: (state) => {
        setVolumePercent(state.volumePercent);
        setIsMuted(state.muted);
        setIsPlaying(state.playing);
        setSyncStateReady(true);
      },
      onLibraryChange: () => {
        void syncConnection.current?.readLibrary().then(setSharedTracks).catch((error: unknown) => {
          setMessage(error instanceof Error ? `The shared library could not be refreshed: ${error.message}` : 'The shared library could not be refreshed.');
        });
      },
      onOwner: (ownerClientId) => {
        syncOwnerRef.current = ownerClientId;
        syncLeaderRef.current = ownerClientId === syncClientId;
        if (ownerClientId && ownerClientId !== syncClientId && audio.current && !audio.current.paused) {
          audio.current.pause();
          setIsPlaying(false);
          setMessage('Another paired client is playing music on this device.');
        }
      },
      onCommand: (command) => {
        if (command.type === 'play') {
          if (!syncOwnerRef.current || syncOwnerRef.current === syncClientId) playFromSyncRef.current();
        } else if (command.type === 'pause') {
          if (syncLeaderRef.current && audio.current) audio.current.pause();
          setIsPlaying(false);
        } else if (command.type === 'mute') {
          setIsMuted(true);
          if (syncLeaderRef.current && audio.current) audio.current.muted = true;
        } else if (command.type === 'unmute') {
          setIsMuted(false);
          if (syncLeaderRef.current && audio.current) audio.current.muted = false;
        } else if (command.type === 'volume') {
          setVolumePercent(command.value);
        }
      },
      onError: setMessage,
    });
    if (!connection) {
      setSyncConnectionStatus('unconfigured');
      return;
    }
    syncConnection.current = connection;
    return () => {
      connection.close();
      if (syncLeaderRef.current) {
        syncLeaderRef.current = false;
        syncOwnerRef.current = null;
        void connection.lease('release').catch(() => {
          setMessage('The music sync lease will expire automatically after this client closes.');
        });
      }
      if (syncConnection.current === connection) syncConnection.current = null;
    };
  }, [syncClientId, syncPairing]);

  useEffect(() => {
    const connection = syncConnection.current;
    if (!connection || syncConnectionStatus !== 'connected') {
      setSyncUploadStatus('idle');
      return;
    }
    const localTracks = [
      ...privateUrls.map((track) => ({
        id: track.id,
        title: track.title,
        artist: track.artist,
        audioUrl: track.audioUrl,
      })),
      ...deviceTracks.map((track) => ({
        id: track.id,
        title: track.title,
        artist: track.artist,
        file: track.file,
      })),
    ];
    const hasImportedFiles = deviceTracks.length > 0;
    setSyncUploadStatus(hasImportedFiles ? 'uploading' : 'idle');
    let active = true;
    void connection.syncLibrary(localTracks).then((syncedTracks) => {
      if (!active) return;
      setSharedTracks(syncedTracks);
      setSyncUploadStatus(hasImportedFiles ? 'ready' : 'idle');
    }).catch((error: unknown) => {
      if (!active) return;
      setSyncUploadStatus(hasImportedFiles ? 'error' : 'idle');
      setMessage(error instanceof Error ? `The library could not be shared: ${error.message}` : 'The library could not be shared.');
    });
    return () => { active = false; };
  }, [deviceTracks, privateUrls, syncConnectionStatus, syncPairing]);

  useEffect(() => {
    const connection = syncConnection.current;
    if (!connection || syncConnectionStatus !== 'connected') return;
    const heartbeat = window.setInterval(() => {
      if (!syncLeaderRef.current) return;
      void connection.lease('heartbeat').then((lease) => {
        if (lease.granted) return;
        syncLeaderRef.current = false;
        syncOwnerRef.current = lease.ownerClientId;
        audio.current?.pause();
        setIsPlaying(false);
        setMessage('This player lost its sync lock and has paused to prevent duplicate music.');
      }).catch((error: unknown) => {
        syncLeaderRef.current = false;
        syncOwnerRef.current = null;
        audio.current?.pause();
        setIsPlaying(false);
        setMessage(error instanceof Error ? `Music sync was lost; playback paused: ${error.message}` : 'Music sync was lost; playback paused.');
      });
    }, 3000);
    return () => window.clearInterval(heartbeat);
  }, [syncConnectionStatus, syncPairing]);

  useEffect(() => {
    const synchronizeAudio = () => {
      const element = audio.current;
      if (hasAudibleVideo()) {
        if (!element || element.paused) return;
        pausedByVideoRef.current = true;
        const track = activeTrackRef.current;
        if (track) {
          try {
            savePlayer(track.id, element.currentTime, false);
          } catch (error) {
            setMessage(error instanceof Error ? error.message : 'The playback position could not be saved.');
          }
        }
        element.pause();
        setMessage('Music paused while a video has sound. Mute or pause the video to resume music.');
        return;
      }

      if (pausedByVideoRef.current) {
        pausedByVideoRef.current = false;
        playTrackRef.current();
      }
    };
    const mediaEvents = ['play', 'playing', 'pause', 'ended', 'volumechange'];
    mediaEvents.forEach((event) => document.addEventListener(event, synchronizeAudio, true));
    synchronizeAudio();
    return () => {
      mediaEvents.forEach((event) => document.removeEventListener(event, synchronizeAudio, true));
    };
  }, []);

  useEffect(() => {
    if (!isReady || !activeTrack || !shouldAutoplayOnLoad.current ||
      (syncPairing && isMusicSyncConfigured() && (!syncStateReady || syncConnectionStatus !== 'connected'))) return;
    const restored = tracks.find((track) => track.id === restoredTrack.current);
    if (restored && restored.id !== activeTrack.id) return;
    shouldAutoplayOnLoad.current = false;
    void play();
  }, [activeTrack, isReady, play, syncConnectionStatus, syncPairing, syncStateReady, tracks]);

  useEffect(() => {
    const resumeAfterInteraction = (event: PointerEvent) => {
      if (volumePercent > 100 && enhancementSupported) enableAudioEnhancement();
      const target = event.target;
      const clickedPlayer = target instanceof Node && audio.current?.parentElement?.contains(target);
      if (needsResume && !clickedPlayer) playTrackRef.current();
    };
    window.addEventListener('pointerdown', resumeAfterInteraction, { once: true });
    return () => window.removeEventListener('pointerdown', resumeAfterInteraction);
  }, [enableAudioEnhancement, enhancementSupported, needsResume, volumePercent]);

  const saveSyncPairing = (code: string) => {
    const pairing = parseMusicSyncCode(code);
    if (!pairing) {
      setMessage('Enter a valid pairing code copied from another client on this device.');
      return;
    }
    setPendingPairing(pairing);
  };

  const confirmSyncPairing = () => {
    const pairing = pendingPairing;
    if (!pairing) return;
    try {
      saveMusicSyncCode(pairing);
      setSyncPairing(pairing);
      setSyncCodeInput(getMusicSyncCode(pairing));
      setAdditionalDeviceCode('');
      setPendingPairing(null);
      setMessage('This client is paired. Repeat with the same code on other sites on this device.');
    } catch (error) {
      setMessage(error instanceof Error ? `The pairing code could not be saved: ${error.message}` : 'The pairing code could not be saved.');
    }
  };

  const generateSyncPairing = () => {
    const code = createMusicSyncCode();
    setSyncCodeInput(code);
    saveSyncPairing(code);
  };

  const sendSyncCommand = (command: { type: 'play' | 'pause' | 'mute' | 'unmute' | 'volume'; value?: number }) => {
    const connection = syncConnection.current;
    if (!connection) return;
    void connection.sendCommand(command).catch((error: unknown) => {
      setMessage(error instanceof Error ? `The shared music control failed: ${error.message}` : 'The shared music control failed.');
    });
  };

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage('Pairing code copied.');
    } catch (error) {
      setMessage(error instanceof Error ? `Could not copy the pairing code: ${error.message}` : 'Could not copy the pairing code.');
    }
  };

  const createDevicePairing = () => {
    if (!syncPairing) return;
    setAdditionalDeviceCode(createAdditionalDeviceCode(syncPairing));
  };

  const disconnectSync = () => {
    const connection = syncConnection.current;
    if (syncLeaderRef.current && connection) {
      void connection.lease('release').catch((error: unknown) => {
        setMessage(error instanceof Error ? `The sync lock could not be released: ${error.message}` : 'The sync lock could not be released.');
      });
    }
    syncLeaderRef.current = false;
    syncOwnerRef.current = null;
    audio.current?.pause();
    try {
      saveMusicSyncCode(null);
      setSyncPairing(null);
      setSharedTracks([]);
      setSyncCodeInput('');
      setAdditionalDeviceCode('');
      setIsPlaying(false);
    } catch (error) {
      setMessage(error instanceof Error ? `Could not remove pairing: ${error.message}` : 'Could not remove pairing.');
    }
  };

  const savePrivateUrls = (next: PrivateUrlTrack[]) => {
    try {
      window.localStorage.setItem(PRIVATE_URLS_KEY, JSON.stringify(next));
      setPrivateUrls(next);
      setMessage('');
    } catch {
      setMessage('Your browser could not save this private playlist.');
    }
  };

  const addFiles = async (files: ArrayLike<File> | null) => {
    if (!files || files.length === 0) return;
    const audioFiles = Array.from(files).filter((file) => file.type.startsWith('audio/'));
    if (!audioFiles.length) {
      setMessage('Choose one or more audio files.');
      return;
    }
    try {
      const added = await addDeviceTracks(audioFiles);
      const next = added.map((track) => {
        const src = URL.createObjectURL(track.file);
        objectUrls.current.add(src);
        return { ...track, src };
      });
      setDeviceTracks((current) => [...current, ...next]);
      const storageLocation = added[0]?.storage === 'opfs' ? 'the browser File System (OPFS)' : 'IndexedDB';
      setMessage(`${next.length} track${next.length === 1 ? '' : 's'} saved privately in ${storageLocation} on this device.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The selected music could not be saved.');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const openAudioPicker = async () => {
    try {
      const files = await chooseAudioFiles();
      if (files === null) {
        fileInput.current?.click();
        return;
      }
      await addFiles(files);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setMessage(error instanceof Error ? error.message : 'The selected audio files could not be opened.');
    }
  };

  const addUrl = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const parsed = new URL(urlValue.trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Use an http or https audio URL.');
      const track: PrivateUrlTrack = {
        id: `url-${crypto.randomUUID()}`,
        title: urlTitle.trim() || parsed.pathname.split('/').pop() || 'Saved audio link',
        artist: 'Saved on this device',
        audioUrl: parsed.href,
      };
      savePrivateUrls([...privateUrls, track]);
      setUrlTitle('');
      setUrlValue('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Enter a valid audio URL.');
    }
  };

  const deleteTrack = async (track: PlayerTrack) => {
    try {
      if (track.kind === 'device') {
        await removeDeviceTrack(track.id);
        const removed = deviceTracks.find((item) => item.id === track.id);
        if (removed) {
          URL.revokeObjectURL(removed.src);
          objectUrls.current.delete(removed.src);
        }
        setDeviceTracks((current) => current.filter((item) => item.id !== track.id));
      } else if (track.kind === 'private-url') {
        savePrivateUrls(privateUrls.filter((item) => item.id !== track.id));
      }
      if (syncConnection.current && track.kind !== 'public') {
        await syncConnection.current.deleteTrack(track.id);
        setSharedTracks((current) => current.filter((item) => item.id !== track.id));
      }
      if (track.id === activeId) {
        const nextTracks = tracks.filter((item) => item.id !== track.id);
        setActiveId(nextTracks[0]?.id ?? '');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The track could not be removed.');
    }
  };

  const togglePlayback = () => {
    if (syncConnection.current) {
      sendSyncCommand({ type: isPlaying ? 'pause' : 'play' });
      return;
    }
    if (!audio.current) return;
    if (isPlaying) {
      if (activeTrack) {
        try {
          savePlayer(activeTrack.id, audio.current.currentTime, false);
        } catch (error) {
          setMessage(error instanceof Error ? error.message : 'The playback position could not be saved.');
        }
      }
      audio.current.pause();
      return;
    }
    void play(true);
  };

  const stopPlayback = () => {
    const element = audio.current;
    if (syncConnection.current) {
      sendSyncCommand({ type: 'pause' });
      if (syncLeaderRef.current) {
        syncLeaderRef.current = false;
        syncOwnerRef.current = null;
        void syncConnection.current.lease('release').catch((error: unknown) => {
          setMessage(error instanceof Error ? `The sync lock could not be released: ${error.message}` : 'The sync lock could not be released.');
        });
      }
    }
    if (!element) return;
    pausedByVideoRef.current = false;
    playAfterLoad.current = false;
    element.pause();
    setIsPlaying(false);
    setProgress(0);
    setNeedsResume(false);
    lastSavedSecond.current = -1;
    try {
      if (element.readyState > 0) element.currentTime = 0;
      if (activeTrack) savePlayer(activeTrack.id, 0, false);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Playback could not be stopped.');
    }
  };

  const toggleMute = () => {
    const muted = !isMuted;
    setIsMuted(muted);
    if (audio.current) audio.current.muted = muted;
    if (syncConnection.current) sendSyncCommand({ type: muted ? 'mute' : 'unmute' });
  };

  const onTimeUpdate = () => {
    const element = audio.current;
    if (!element || !activeTrack) return;
    setProgress(Number.isFinite(element.duration) && element.duration > 0 ? element.currentTime / element.duration : 0);
    const second = Math.floor(element.currentTime);
    if (second === lastSavedSecond.current) return;
    lastSavedSecond.current = second;
    try {
      savePlayer(activeTrack.id, element.currentTime, !element.paused);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The playback position could not be saved.');
    }
  };

  return (
    <div className="music-player" id="listen">
      <audio
        key={audioProcessingEnabled ? 'power-audio' : 'native-audio'}
        ref={audio}
        loop={tracks.length === 1}
        preload="none"
        onVolumeChange={() => {
          if (volumePercent > 100 && audioProcessingEnabled) {
            enableAudioEnhancement(volumeGain, volumeBass);
          }
        }}
        onTimeUpdate={onTimeUpdate}
        onPlay={() => {
          setIsPlaying(true);
          setNeedsResume(false);
          if (!nativeFallbackPending.current) playAfterLoad.current = false;
        }}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          if (tracks.length > 1) selectNextTrack(true);
        }}
        onError={() => {
          if (activeTrack) setMessage(`Could not load “${activeTrack.title}”. Check the audio URL or file.`);
        }}
      />
      {isOpen && (
        <section className="playlist-popover" aria-label="Music library">
          <div className="playlist-heading">
            <div>
              <span className="eyebrow">YOUR LISTENING SPACE</span>
              <h2>Music library</h2>
            </div>
            <button type="button" className="icon-button" aria-label="Close music library" onClick={() => setIsOpen(false)}><X size={18} /></button>
          </div>
          <p className="privacy-note">Without pairing, tracks stay in this browser. Pairing shares your saved links and uploads local audio files to the shared music room.</p>
          <div className="music-sync-settings">
            <h3>Sync music across clients</h3>
            {syncUploadStatus === 'uploading' && <p className="privacy-note" role="status">Uploading imported audio to the shared room. Keep this site open.</p>}
            {syncUploadStatus === 'ready' && <p className="privacy-note" role="status">Imported audio is uploaded and ready to play on other connected sites.</p>}
            <p>{!isMusicSyncConfigured()
              ? 'The shared relay must be deployed and configured before sync can connect.'
              : syncPairing
                ? `Private pairing · ${syncConnectionStatus}`
                : 'Pair the sites on this device using the same private code.'}</p>
            {pendingPairing ? (
              <div className="add-music" role="group" aria-labelledby="sync-confirm-title">
                <h4 id="sync-confirm-title">Confirm pairing</h4>
                <p className="privacy-note">This shares saved audio links and uploads this browser’s imported audio to the room. Anyone with this code can listen to or remove shared tracks.</p>
                <input className="sync-code-input" aria-label="Pairing code awaiting confirmation" readOnly value={getMusicSyncCode(pendingPairing)} />
                <div className="sync-actions">
                  <button type="button" className="secondary-button" onClick={() => setPendingPairing(null)}>Cancel</button>
                  <button type="button" className="secondary-button" onClick={confirmSyncPairing}>Confirm &amp; connect</button>
                </div>
              </div>
            ) : syncPairing ? (
              <>
                <input className="sync-code-input" aria-label="This device pairing code" readOnly value={getMusicSyncCode(syncPairing)} />
                <div className="sync-actions">
                  <button type="button" className="secondary-button" onClick={() => void copyText(getMusicSyncCode(syncPairing))}>Copy this device code</button>
                  <button type="button" className="secondary-button" onClick={createDevicePairing}>Create another device code</button>
                  <button type="button" className="secondary-button" onClick={disconnectSync}>Disconnect sync</button>
                </div>
                {additionalDeviceCode && (
                  <div className="sync-device-code">
                    <input className="sync-code-input" aria-label="New device pairing code" readOnly value={additionalDeviceCode} />
                    <button type="button" className="secondary-button" onClick={() => void copyText(additionalDeviceCode)}>Copy new device code</button>
                  </div>
                )}
              </>
            ) : (
              <>
                <input className="sync-code-input" aria-label="Private music pairing code" value={syncCodeInput} onChange={(event) => setSyncCodeInput(event.currentTarget.value)} placeholder="Paste pairing code" />
                <div className="sync-actions">
                  <button type="button" className="secondary-button" onClick={generateSyncPairing}>Create a private code</button>
                  <button type="button" className="secondary-button" onClick={() => saveSyncPairing(syncCodeInput)}>Connect this site</button>
                </div>
              </>
            )}
          </div>
          <div className="track-list">
            {tracks.length ? tracks.map((track, index) => (
              <div className={`track-row ${track.id === activeTrack?.id ? 'selected' : ''}`} key={track.id}>
                <button type="button" className="track-select" onClick={() => selectTrack(index, Boolean(audio.current && !audio.current.paused))} aria-current={track.id === activeTrack?.id ? 'true' : undefined}>
                  <span className="track-art"><Music2 size={16} /></span>
                  <span className="track-label"><strong>{track.title}</strong><small>{track.artist} · {track.kind === 'public' ? 'Public playlist' : track.kind === 'shared' ? 'Shared music room' : syncPairing ? 'Shared music room' : 'Private to this device'}</small></span>
                </button>
                {track.kind !== 'public' && <button type="button" className="icon-button remove-track" aria-label={`Remove ${track.title}`} onClick={() => void deleteTrack(track)}><Trash2 size={15} /></button>}
              </div>
            )) : <p className="empty-library">No tracks yet. Add music you have permission to use.</p>}
          </div>
          <div className="add-music">
            <button type="button" className="secondary-button" onClick={() => void openAudioPicker()}><Upload size={15} /> Add audio files</button>
            <input ref={fileInput} className="visually-hidden" type="file" accept="audio/*" multiple onChange={(event) => void addFiles(event.currentTarget.files)} />
            <p className="storage-note">Imported files use this browser's File System (OPFS) or IndexedDB. Pairing uploads these audio files to the shared room; the relay stores audio in MongoDB GridFS.</p>
            <form className="url-form" onSubmit={addUrl}>
              <label htmlFor="track-title">Save an audio URL to this device</label>
              <input id="track-title" value={urlTitle} onChange={(event) => setUrlTitle(event.target.value)} placeholder="Track title (optional)" />
              <div className="url-entry">
                <input aria-label="Audio URL" type="url" required value={urlValue} onChange={(event) => setUrlValue(event.target.value)} placeholder="https://example.com/song.mp3" />
                <button type="submit" className="icon-button" aria-label="Add audio URL"><Plus size={18} /></button>
              </div>
            </form>
          </div>
          {message && <p className="player-message" role="status">{message}</p>}
        </section>
      )}
      <button type="button" className="now-playing" onClick={() => setIsOpen((open) => !open)} aria-expanded={isOpen} aria-label="Open music library">
        <span className="record-icon"><Disc3 size={19} /></span>
        <span className="now-playing-text"><strong>{activeTrack?.title ?? 'Your music'}</strong><small>{activeTrack?.artist ?? (isReady ? 'Add your first track' : 'Loading library…')}</small></span>
      </button>
      <div className="player-controls">
        <button type="button" className="player-icon" aria-label="Previous track" title="Previous track" disabled={tracks.length < 2} onClick={() => selectTrack((activeIndex - 1 + tracks.length) % tracks.length, Boolean(audio.current && !audio.current.paused))}><SkipBack size={16} /></button>
        <button type="button" className="play-button" aria-label={isPlaying ? 'Pause music' : needsResume ? 'Resume music' : 'Play music'} title={isPlaying ? 'Pause' : needsResume ? 'Resume' : 'Play'} disabled={!activeTrack} onClick={togglePlayback}>{isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</button>
        <button type="button" className="player-icon" aria-label="Stop music" title="Stop" disabled={!activeTrack} onClick={stopPlayback}><Square size={14} fill="currentColor" /></button>
        <button type="button" className="player-icon" aria-label="Next track" title="Next track" disabled={tracks.length < 2} onClick={() => selectNextTrack(Boolean(audio.current && !audio.current.paused))}><SkipForward size={16} /></button>
        <button type="button" className="player-icon shuffle-toggle" aria-label="Shuffle tracks" title="Shuffle tracks" aria-pressed={isShuffleEnabled} disabled={tracks.length < 2} onClick={() => setIsShuffleEnabled((enabled) => !enabled)}><Shuffle size={16} /></button>
      </div>
      <div className="volume-control">
        <button type="button" className="player-icon" aria-label={isMuted ? 'Unmute all paired players' : 'Mute all paired players'} title={isMuted ? 'Unmute all paired players' : 'Mute all paired players'} onClick={toggleMute}>
          {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <input
          type="range"
          min="0"
          max={enhancementSupported ? 200 : 100}
          step="10"
          value={Math.min(volumePercent, enhancementSupported ? 200 : 100)}
          aria-label="Volume"
          onChange={(event) => {
            const nextPercent = Number(event.currentTarget.value);
            const boost = Math.max(0, Math.min(1, (nextPercent - 100) / 100));
            setVolumePercent(nextPercent);
            if (audio.current) audio.current.volume = Math.min(nextPercent, 100) / 100;
            if (nextPercent > 100 && enhancementSupported && useNativePlayback) switchToEnhancedPlayback();
            else if (nextPercent > 100 && audioProcessingEnabled) enableAudioEnhancement(1 + boost * 9, boost * 18);
            else if (audioPower.current) enableAudioEnhancement(1, 0);
            if (syncConnection.current) sendSyncCommand({ type: 'volume', value: nextPercent });
          }}
        />
        <output>{Math.min(volumePercent, enhancementSupported ? 200 : 100)}%</output>
      </div>
      <div className="player-progress" aria-label="Track progress">
        <span style={{ width: `${progress * 100}%` }} />
      </div>
      <span className="visually-hidden" role="status">{message || (needsResume ? 'Playback position restored. Click or tap anywhere to resume.' : '')}</span>
    </div>
  );
}
