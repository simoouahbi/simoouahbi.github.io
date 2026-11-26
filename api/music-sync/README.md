# Cloudflare music sync

The GitHub Pages site remains static at `https://simoouahbi.github.io`. The
shared relay runs separately as a Cloudflare Worker at:

`https://simoouahbighalinoa-github-io.simoouahbi-483.workers.dev`

The Worker serves the Vite assets and the `/v1/*` music API. A SQLite-backed
Durable Object keeps each room's library metadata, playback state, and live
connections. R2 stores imported audio files. The Worker configuration and API
are in `wrangler.jsonc` and `cloudflare-worker.mjs`.

## One-time Cloudflare setup

1. In Cloudflare, create an R2 bucket named `simoouahbi-music-sync`.
2. In Workers & Pages, keep the project root at the repository root, set the
   build command to `npm run build`, and the deploy command to
   `npx wrangler deploy`.
3. Deploy the project. Wrangler reads `wrangler.jsonc` and provisions the
   `MUSIC_ROOMS` SQLite Durable Object binding and the `MUSIC_FILES` R2 binding.
   The configured `ALLOWED_ORIGINS` lists the GitHub Pages sites allowed to
   connect; add any other exact HTTPS origins there before deploying.
4. Visit the Worker URL followed by `/healthz`. It should return HTTP 200 and
   `{"status":"ok"}`.

The main site defaults to this Worker URL. For each other GitHub Pages
repository, add the same URL as the GitHub Actions repository variable
`VITE_MUSIC_SYNC_URL`, then rebuild and redeploy that site. GitHub Pages itself
cannot run the relay backend.

## Free-plan limits

This setup uses Cloudflare Workers, SQLite-backed Durable Objects, and standard
R2 storage, all of which have free allocations. It can remain free while usage
stays within Cloudflare's current limits: Workers and Durable Objects have
daily request/compute limits, and R2 currently includes 10 GB-month storage,
1 million Class A operations, and 10 million Class B operations per month.
Usage above free allocations may fail or incur charges depending on the
product. Check Cloudflare's current [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/),
and [R2 pricing](https://developers.cloudflare.com/r2/pricing/) before sharing
large libraries. Audio files are limited to 100 MB each.

## Pairing

Open the music library on the source site, choose **Create a private code**, and
approve the sharing prompt. On each other site, paste that code and choose
**Connect this site**. Wait until the status says **Private pairing ·
connected**. Saved audio URLs and imported audio files will then sync to the
room. Public playlist items are not copied.

Treat pairing codes as private bearer credentials: anyone with a code can view,
listen to, or remove that room's shared tracks.

## Local checks

```sh
npm --prefix api/music-sync test
```
