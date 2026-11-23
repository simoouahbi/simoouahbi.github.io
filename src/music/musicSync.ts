export interface MusicSyncPairing {
  roomId: string;
  deviceId: string;
}

export interface MusicSyncState {
  volumePercent: number;
  muted: boolean;
  playing: boolean;
}

export type MusicSyncCommand =
  | { type: 'play' | 'pause' | 'mute' | 'unmute'; senderId: string }
  | { type: 'volume'; value: number; senderId: string };

export interface MusicSyncConnection {
  clientId: string;
  close: () => void;
  lease: (action: 'acquire' | 'heartbeat' | 'release') => Promise<{ granted: boolean; ownerClientId: string | null }>;
  sendCommand: (command: { type: MusicSyncCommand['type']; value?: number }) => Promise<void>;
}

export const MUSIC_SYNC_STORAGE_KEY = 'eco:music-sync-pairing';
const relayUrl = import.meta.env.VITE_MUSIC_SYNC_URL?.trim().replace(/\/+$/, '');

export function isMusicSyncConfigured() {
  return Boolean(relayUrl);
}

function isHexCode(value: unknown, length: number): value is string {
  return typeof value === 'string' && value.length === length && /^[a-f0-9]+$/i.test(value);
}

export function parseMusicSyncCode(value: string): MusicSyncPairing | null {
  const [roomId, deviceId, extra] = value.trim().split('.');
  if (extra !== undefined || !isHexCode(roomId, 48) || !isHexCode(deviceId, 24)) return null;
  return { roomId: roomId.toLowerCase(), deviceId: deviceId.toLowerCase() };
}

function randomHexCode(bytes: number) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('');
}

export function createMusicSyncCode() {
  return `${randomHexCode(24)}.${randomHexCode(12)}`;
}

export function createAdditionalDeviceCode(pairing: MusicSyncPairing) {
  return `${pairing.roomId}.${randomHexCode(12)}`;
}

export function readMusicSyncCode() {
  try {
    const stored = window.localStorage.getItem(MUSIC_SYNC_STORAGE_KEY);
    return stored ? parseMusicSyncCode(stored) : null;
  } catch {
    return null;
  }
}

export function saveMusicSyncCode(pairing: MusicSyncPairing | null) {
  if (pairing) {
    window.localStorage.setItem(MUSIC_SYNC_STORAGE_KEY, `${pairing.roomId}.${pairing.deviceId}`);
  } else {
    window.localStorage.removeItem(MUSIC_SYNC_STORAGE_KEY);
  }
}

export function getMusicSyncCode(pairing: MusicSyncPairing) {
  return `${pairing.roomId}.${pairing.deviceId}`;
}

export function createMusicSyncClientId() {
  try {
    const key = 'eco:music-sync-client';
    const existing = window.sessionStorage.getItem(key);
    if (isHexCode(existing, 32)) return existing;
    const clientId = randomHexCode(16);
    window.sessionStorage.setItem(key, clientId);
    return clientId;
  } catch {
    return randomHexCode(16);
  }
}

export function connectMusicSync(
  pairing: MusicSyncPairing,
  clientId: string,
  handlers: {
    onCommand: (command: MusicSyncCommand) => void;
    onOwner: (clientId: string | null) => void;
    onState: (state: MusicSyncState) => void;
    onConnectionChange: (connected: boolean) => void;
    onError: (message: string) => void;
  },
): MusicSyncConnection | null {
  if (!relayUrl) return null;
  const eventUrl = new URL(`${relayUrl}/v1/events`);
  eventUrl.searchParams.set('roomId', pairing.roomId);
  eventUrl.searchParams.set('deviceId', pairing.deviceId);
  eventUrl.searchParams.set('clientId', clientId);
  const events = new EventSource(eventUrl);
  events.onopen = () => handlers.onConnectionChange(true);
  events.onerror = () => handlers.onConnectionChange(false);
  events.addEventListener('owner', (event) => {
    try {
      const data: unknown = JSON.parse((event as MessageEvent<string>).data);
      if (typeof data === 'object' && data !== null && 'clientId' in data &&
        (typeof data.clientId === 'string' || data.clientId === null)) {
        handlers.onOwner(data.clientId);
      }
    } catch {
      handlers.onError('The music sync service sent invalid owner data.');
    }
  });
  events.addEventListener('state', (event) => {
    try {
      const data: unknown = JSON.parse((event as MessageEvent<string>).data);
      if (typeof data === 'object' && data !== null &&
        'volumePercent' in data && typeof data.volumePercent === 'number' && Number.isInteger(data.volumePercent) &&
        'muted' in data && typeof data.muted === 'boolean' &&
        'playing' in data && typeof data.playing === 'boolean') {
        handlers.onState({
          volumePercent: data.volumePercent,
          muted: data.muted,
          playing: data.playing,
        });
      }
    } catch {
      handlers.onError('The music sync service sent invalid playback state.');
    }
  });
  events.addEventListener('command', (event) => {
    try {
      const data: unknown = JSON.parse((event as MessageEvent<string>).data);
      if (typeof data !== 'object' || data === null || !('type' in data) ||
        typeof data.type !== 'string' || !('senderId' in data) || typeof data.senderId !== 'string') return;
      if (data.type === 'volume' && 'value' in data && typeof data.value === 'number' && Number.isInteger(data.value) &&
        data.value >= 0 && data.value <= 200) {
        handlers.onCommand({ type: 'volume', value: data.value, senderId: data.senderId });
      } else if (['play', 'pause', 'mute', 'unmute'].includes(data.type)) {
        handlers.onCommand({
          type: data.type as 'play' | 'pause' | 'mute' | 'unmute',
          senderId: data.senderId,
        });
      }
    } catch {
      handlers.onError('The music sync service sent an invalid command.');
    }
  });

  const post = async (path: string, body: Record<string, unknown>) => {
    const response = await fetch(`${relayUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, ...pairing, clientId }),
    });
    const result: unknown = await response.json();
    if (!response.ok) {
      const message = typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string'
        ? result.error
        : 'The music sync request failed.';
      throw new Error(message);
    }
    return result;
  };

  return {
    clientId,
    close: () => events.close(),
    lease: async (action) => {
      const result = await post('/v1/lease', { action }) as { granted?: unknown; ownerClientId?: unknown };
      return {
        granted: result.granted === true,
        ownerClientId: typeof result.ownerClientId === 'string' ? result.ownerClientId : null,
      };
    },
    sendCommand: async (command) => {
      await post('/v1/command', { command });
    },
  };
}
