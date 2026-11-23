import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const DEFAULT_ORIGINS = [
  'https://adaligo.github.io',
  'https://adamghaliouahbi.github.io',
  'https://khadijachahmoud.github.io',
  'https://noaouahbi.github.io',
  'https://simoouahbi.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];
const MAX_BODY_BYTES = 4096;
const MAX_CONNECTIONS = 2000;
const LEASE_TTL_MS = 10000;
const ALLOWED_COMMANDS = new Set(['play', 'pause', 'mute', 'unmute', 'volume']);

function sendJson(response, status, value, corsOrigin) {
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  };
  if (corsOrigin) {
    headers['Access-Control-Allow-Origin'] = corsOrigin;
    headers.Vary = 'Origin';
  }
  response.writeHead(status, headers);
  response.end(JSON.stringify(value));
}

function readJson(request) {
  return new Promise((resolveBody, rejectBody) => {
    let body = '';
    let size = 0;
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        rejectBody(new Error('Request body is too large.'));
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on('end', () => {
      try {
        resolveBody(JSON.parse(body));
      } catch {
        rejectBody(new Error('Request body must be valid JSON.'));
      }
    });
    request.on('error', rejectBody);
  });
}

function isToken(value, minLength = 16) {
  return typeof value === 'string' &&
    value.length >= minLength &&
    value.length <= 64 &&
    /^[a-f0-9]+$/i.test(value);
}

function parseIdentity(value) {
  if (!value || typeof value !== 'object') return null;
  const { roomId, deviceId, clientId } = value;
  if (!isToken(roomId, 32) || !isToken(deviceId) || !isToken(clientId)) return null;
  return { roomId: roomId.toLowerCase(), deviceId: deviceId.toLowerCase(), clientId: clientId.toLowerCase() };
}

function leaseKey(roomId, deviceId) {
  return `${roomId}:${deviceId}`;
}

export function createMusicSyncServer({
  allowedOrigins = DEFAULT_ORIGINS,
  leaseTtlMs = LEASE_TTL_MS,
} = {}) {
  const origins = new Set(allowedOrigins.map((origin) => origin.toLowerCase()));
  const connections = new Set();
  const leases = new Map();
  const roomStates = new Map();

  const sendEvent = (connection, event, data) => {
    if (!connection.response.destroyed) {
      connection.response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  const broadcast = (roomId, event, data, deviceId) => {
    for (const connection of connections) {
      if (connection.roomId === roomId && (!deviceId || connection.deviceId === deviceId)) {
        sendEvent(connection, event, data);
      }
    }
  };

  const server = createServer(async (request, response) => {
    const origin = request.headers.origin?.toLowerCase();
    const originAllowed = Boolean(origin && origins.has(origin));
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;

    if (pathname === '/healthz' && request.method === 'GET') {
      sendJson(response, 200, { status: 'ok' });
      return;
    }
    if (!originAllowed) {
      sendJson(response, 403, { error: 'A configured client origin is required.' });
      return;
    }
    response.setHeader('Access-Control-Allow-Origin', request.headers.origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    if (pathname === '/v1/events' && request.method === 'GET') {
      const identity = parseIdentity(Object.fromEntries(new URL(request.url, 'http://localhost').searchParams));
      if (!identity) {
        sendJson(response, 400, { error: 'A valid room, device, and client code is required.' }, request.headers.origin);
        return;
      }
      if (connections.size >= MAX_CONNECTIONS) {
        sendJson(response, 503, { error: 'The music sync service is at capacity.' }, request.headers.origin);
        return;
      }
      response.writeHead(200, {
        'Cache-Control': 'no-cache, no-transform',
        'Content-Type': 'text/event-stream; charset=utf-8',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': request.headers.origin,
        Vary: 'Origin',
      });
      response.write('retry: 3000\n\n');
      const connection = { ...identity, response };
      connections.add(connection);
      const state = roomStates.get(identity.roomId) ?? { volumePercent: 100, muted: false, playing: false };
      sendEvent(connection, 'state', state);
      const lease = leases.get(leaseKey(identity.roomId, identity.deviceId));
      sendEvent(connection, 'owner', {
        clientId: lease && lease.expiresAt > Date.now() ? lease.clientId : null,
      });
      const keepAlive = setInterval(() => {
        if (!response.destroyed) response.write(': keepalive\n\n');
      }, 15000);
      keepAlive.unref();
      response.on('close', () => {
        clearInterval(keepAlive);
        connections.delete(connection);
      });
      return;
    }

    if (pathname === '/v1/state' && request.method === 'GET') {
      const roomId = new URL(request.url ?? '/', 'http://localhost').searchParams.get('roomId');
      if (!isToken(roomId, 32)) {
        sendJson(response, 400, { error: 'A valid room code is required.' }, request.headers.origin);
        return;
      }
      sendJson(response, 200, roomStates.get(roomId.toLowerCase()) ?? { volumePercent: 100, muted: false, playing: false }, request.headers.origin);
      return;
    }

    if (pathname === '/v1/lease' && request.method === 'POST') {
      let payload;
      try {
        payload = await readJson(request);
      } catch (error) {
        sendJson(response, 400, { error: error.message }, request.headers.origin);
        return;
      }
      const identity = parseIdentity(payload);
      if (!identity || !['acquire', 'heartbeat', 'release'].includes(payload.action)) {
        sendJson(response, 400, { error: 'Invalid music lease request.' }, request.headers.origin);
        return;
      }
      const key = leaseKey(identity.roomId, identity.deviceId);
      const current = leases.get(key);
      const now = Date.now();
      if (payload.action === 'release') {
        if (current?.clientId === identity.clientId) leases.delete(key);
        const owner = leases.get(key);
        broadcast(identity.roomId, 'owner', { clientId: owner?.clientId ?? null }, identity.deviceId);
        sendJson(response, 200, { granted: false, ownerClientId: owner?.clientId ?? null }, request.headers.origin);
        return;
      }
      if (payload.action === 'heartbeat') {
        if (!current || current.clientId !== identity.clientId || current.expiresAt <= now) {
          if (current?.expiresAt <= now) leases.delete(key);
          const owner = leases.get(key);
          sendJson(response, 200, { granted: false, ownerClientId: owner?.clientId ?? null }, request.headers.origin);
          return;
        }
      } else if (current && current.expiresAt > now && current.clientId !== identity.clientId) {
        sendJson(response, 200, { granted: false, ownerClientId: current.clientId }, request.headers.origin);
        return;
      }
      leases.set(key, { clientId: identity.clientId, expiresAt: now + leaseTtlMs });
      broadcast(identity.roomId, 'owner', { clientId: identity.clientId }, identity.deviceId);
      sendJson(response, 200, { granted: true, ownerClientId: identity.clientId }, request.headers.origin);
      return;
    }

    if (pathname === '/v1/command' && request.method === 'POST') {
      let payload;
      try {
        payload = await readJson(request);
      } catch (error) {
        sendJson(response, 400, { error: error.message }, request.headers.origin);
        return;
      }
      const identity = parseIdentity(payload);
      const command = payload.command;
      if (!identity || !command || !ALLOWED_COMMANDS.has(command.type)) {
        sendJson(response, 400, { error: 'Invalid music command.' }, request.headers.origin);
        return;
      }
      let state = roomStates.get(identity.roomId) ?? { volumePercent: 100, muted: false, playing: false };
      if (command.type === 'volume') {
        if (!Number.isInteger(command.value) || command.value < 0 || command.value > 200) {
          sendJson(response, 400, { error: 'Volume must be an integer from 0 to 200.' }, request.headers.origin);
          return;
        }
        state = { ...state, volumePercent: command.value };
      } else if (command.type === 'mute' || command.type === 'unmute') {
        state = { ...state, muted: command.type === 'mute' };
      } else if (command.type === 'play' || command.type === 'pause') {
        state = { ...state, playing: command.type === 'play' };
      }
      roomStates.set(identity.roomId, state);
      broadcast(identity.roomId, 'state', state);
      broadcast(identity.roomId, 'command', { type: command.type, value: command.value, senderId: identity.clientId });
      sendJson(response, 202, { accepted: true }, request.headers.origin);
      return;
    }

    sendJson(response, 404, { error: 'Not found.' }, request.headers.origin);
  });

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, lease] of leases) {
      if (lease.expiresAt <= now) {
        leases.delete(key);
        const [roomId, deviceId] = key.split(':');
        broadcast(roomId, 'owner', { clientId: null }, deviceId);
      }
    }
  }, Math.min(leaseTtlMs, 5000));
  cleanup.unref();
  server.on('close', () => clearInterval(cleanup));

  return server;
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMainModule) {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? DEFAULT_ORIGINS.join(','))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const server = createMusicSyncServer({ allowedOrigins });
  const port = Number(process.env.PORT ?? 8788);
  server.listen(port, '0.0.0.0', () => {
    console.log(`Eco music sync relay listening on port ${port}.`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => server.close());
  }
}
