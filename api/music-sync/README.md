# Eco music sync relay

This small Node service coordinates music players across the client GitHub Pages
origins. It carries playback commands and lease metadata only; audio stays in
the browser.

## Run locally

```sh
npm test
npm start
```

The relay listens on port `8788` by default. `PORT` and `ALLOWED_ORIGINS` may be
set by the hosting provider. The service is in-memory and must run as one
instance; restarting it clears active-player leases and shared playback
controls. Client reconnect and lease expiry handle ordinary disconnects.

## Deploy

Use the repository's `render.yaml` blueprint to create the long-running web
service. After deployment, set `VITE_MUSIC_SYNC_URL` to the service's HTTPS URL
in each client site's GitHub Actions environment before building.

Each user pairs a room and a device code in the music library settings. The
pairing code is a bearer credential: keep it private and use the same code for
all client sites on one device. Use a new device code for each additional
device while retaining the same room code to synchronize controls between
devices. The relay accepts requests only from the configured client origins.
