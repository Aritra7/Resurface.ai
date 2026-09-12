# Deploying Resurface.AI

## YouTube OAuth on a hosted deployment

Two things are configured outside the codebase. Both must be right or connecting YouTube
fails for everyone except the developer who set it up.

### 1. APP_URL

The OAuth redirect URI is built from `APP_URL`. Set it in Vercel:

```
APP_URL=https://resurface-ai.vercel.app
```

Without it the app now falls back to Vercel's own production URL, and only then to
localhost. The localhost fallback is the dangerous one: Google accepts the request and
then sends the user back to *their own machine*, where nothing is listening, so the
connection appears to fail for no reason. Set `APP_URL` explicitly and the guesswork
disappears.

Do not rely on `VERCEL_URL` — it changes on every deployment and would never match a
redirect URI registered with Google.

### 2. Google Cloud

In **APIs & Services -> Credentials -> your OAuth client**, the authorized redirect URI
must match `APP_URL` exactly, including scheme and with no trailing slash:

```
https://resurface-ai.vercel.app/api/connect/youtube/callback
```

Keep the localhost entry alongside it for local development; Google allows several.

### 3. Who is allowed to connect

The consent screen is in **Testing** mode. That is deliberate — `youtube.readonly` is a
sensitive scope, and Publishing requires Google verification, which takes weeks.

The consequence: **only Google accounts listed as test users can connect.** Everyone else
gets `access_denied`, which looks identical to cancelling. To let a teammate connect, add
their Google address under **OAuth consent screen -> Test users** (up to 100).

If you need anyone to connect without being listed, the app must be published and
verified. That is not a code change.

### Checklist for a new person connecting YouTube

1. Their Google address is on the Test users list.
2. `APP_URL` is set in Vercel and matches the registered redirect URI.
3. They click through the "Google hasn't verified this app" screen via
   **Advanced -> Go to Resurface**. This is expected in Testing mode.

## Other environment variables

See `.env.example`. `SUPABASE_SECRET_KEY` and `TOKEN_ENCRYPTION_KEY` are required for
imports, pairing and token encryption; the app will not start without them.

`TOKEN_ENCRYPTION_KEY` must be the *same* value in every environment that reads a stored
token. Rotating it makes existing OAuth connections undecryptable, and every user has to
reconnect.
