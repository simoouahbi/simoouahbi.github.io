# Simoouahbi portfolio API

The optional API supports GitHub sign-in and profile-click counting. It is not
configured by default; the static portfolio works without deploying it.

For local development, copy `api/.env.example` to `api/.env`, provide your own
OAuth and database settings, then run:

```sh
npm --prefix api install
npm --prefix api run dev
```

Never commit `api/.env` or production credentials.
