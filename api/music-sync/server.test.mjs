import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { createMusicSyncServer } from './server.mjs';

const origin = 'https://adaligo.github.io';
const roomId = 'a'.repeat(48);
const deviceId = 'b'.repeat(24);
const firstClientId = 'c'.repeat(24);
const secondClientId = 'd'.repeat(24);
let server;
let baseUrl;

before(async () => {
  server = createMusicSyncServer({ allowedOrigins: [origin], leaseTtlMs: 1000 });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await once(server, 'close');
});

async function post(path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('only configured client origins can use the relay', async () => {
  const response = await fetch(`${baseUrl}/v1/state?roomId=${roomId}`, {
    headers: { Origin: 'https://untrusted.example' },
  });
  assert.equal(response.status, 403);
});

test('a device lease allows one player at a time and can be released', async () => {
  const first = { roomId, deviceId, clientId: firstClientId, action: 'acquire' };
  const second = { roomId, deviceId, clientId: secondClientId, action: 'acquire' };
  assert.deepEqual(await (await post('/v1/lease', first)).json(), {
    granted: true,
    ownerClientId: firstClientId,
  });
  assert.deepEqual(await (await post('/v1/lease', second)).json(), {
    granted: false,
    ownerClientId: firstClientId,
  });
  await post('/v1/lease', { ...first, action: 'release' });
  assert.deepEqual(await (await post('/v1/lease', second)).json(), {
    granted: true,
    ownerClientId: secondClientId,
  });
});

test('volume commands are validated and synchronized room-wide', async () => {
  const valid = await post('/v1/command', {
    roomId,
    deviceId,
    clientId: firstClientId,
    command: { type: 'volume', value: 160 },
  });
  assert.equal(valid.status, 202);
  assert.deepEqual(await (await fetch(`${baseUrl}/v1/state?roomId=${roomId}`, {
    headers: { Origin: origin },
  })).json(), { volumePercent: 160, muted: false, playing: false });

  const invalid = await post('/v1/command', {
    roomId,
    deviceId,
    clientId: firstClientId,
    command: { type: 'volume', value: 201 },
  });
  assert.equal(invalid.status, 400);
});
