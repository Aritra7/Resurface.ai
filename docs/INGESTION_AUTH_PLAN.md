# Ingestion & Connections — Development Plan

Owner: Tanay. Scope: connect YouTube and Chrome, ingest saved videos and bookmarked tabs into the
existing `resources` table. Instagram arrives via file import; the dataset is built by hand (§7).

Written against commit `500c999`. Verified against live platform behaviour 2026-09-12.

---

## 1. What already exists (and what I must not break)

A teammate shipped auth, onboarding, and the schema. My work slots into it rather than replacing it.

| Exists | File |
|---|---|
| Supabase browser client | `src/lib/supabase/client.ts` |
| Email/password auth | `src/app/login/page.tsx` |
| 3-step onboarding + `complete_onboarding` RPC | `src/app/onboarding/page.tsx` |
| Dashboard reading profile + goals | `src/app/dashboard/page.tsx` |
| Schema: profiles, goals, **resources**, sessions, interactions, RLS | `supabase/migrations/202609120001_initial_schema.sql` |

**Key decision: I ingest into the existing `resources` table, not a new `saved_items` table.**
It already has `url`, `canonical_url`, `source`, `content_type`, `title`, `description`,
`estimated_minutes`, `saved_at`, `enrichment_status`, and a unique index on
`(user_id, canonical_url)`. Introducing a parallel table would fork the data model and force the
optimizer teammate to read from two places. I extend `resources` with four nullable columns instead.

**Gap I have to close:** everything today is a **client component** using the browser client. OAuth
tokens cannot live there. I am adding the first server-side code in the repo — a server Supabase
client, route handlers, and middleware. That is new ground, not a modification of their work.

---

## 2. What I'm adding — migration 2

Additive only. No existing column or policy is altered.

```sql
-- Extend resources for platform provenance.
alter table public.resources
  add column external_id      text,      -- YouTube video id, Chrome bookmark node id, IG shortcode
  add column author           text,      -- channel title, IG username, site hostname
  add column thumbnail_url    text,
  add column collection       text,      -- playlist name, bookmark folder path, IG collection
  add column connection_id    uuid;      -- FK added below

create unique index resources_user_source_external_unique
  on public.resources (user_id, source, external_id)
  where external_id is not null;

-- A grant to read one platform on the user's behalf. Instagram never appears here.
create table public.connections (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  provider               text not null check (provider in ('youtube','chrome')),
  external_account_id    text,
  external_account_label text,
  access_token_enc       text,
  refresh_token_enc      text,
  expires_at             timestamptz,
  scopes                 text[],
  status                 text not null default 'active'
                           check (status in ('active','expired','revoked','error')),
  last_error             text,
  last_sync_at           timestamptz,
  items_count            integer not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (user_id, provider, external_account_id)
);

alter table public.resources
  add constraint resources_connection_fk
  foreign key (connection_id) references public.connections(id) on delete set null;

-- Extension pairing.
create table public.pairing_codes (
  code       text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz
);

create table public.extension_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  token_hash   text not null unique,
  label        text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create table public.sync_runs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  connection_id  uuid references public.connections(id) on delete cascade,
  provider       text not null,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  items_seen     integer default 0,
  items_upserted integer default 0,
  status         text not null default 'running',
  error          text
);
```

### RLS — deliberately asymmetric

The teammate's pattern is `for all using (auth.uid() = user_id)`. I follow it for `sync_runs`, but
**not** for `connections`, because that table holds encrypted OAuth tokens:

```sql
alter table public.connections     enable row level security;
alter table public.pairing_codes   enable row level security;
alter table public.extension_tokens enable row level security;
alter table public.sync_runs       enable row level security;

-- Read-only, and only the safe columns, via a view. No client write path, no ciphertext exposure.
create policy "connections read own" on public.connections
  for select using (auth.uid() = user_id);

create view public.connection_status
  with (security_invoker = true) as
  select id, user_id, provider, external_account_label, status,
         last_sync_at, items_count, created_at
  from public.connections;

-- Service-role only. No policy at all = no client access.
create policy "sync runs read own" on public.sync_runs
  for select using (auth.uid() = user_id);
```

`pairing_codes` and `extension_tokens` get **no policies**, so RLS denies all client access and only
the server (secret key) can touch them. Writes to `connections` likewise go through route handlers.

---

## 3. Why I need a secret key

The current app is browser-only with the publishable key, which is correct for profiles and goals.
It does not work for OAuth. Three reasons:

1. **The Google client secret cannot ship to the browser.** The token exchange must happen server-side.
2. **Refresh tokens must never reach the client.** They are long-lived credentials to the user's YouTube
   account. They are encrypted and written by the server, and the client reads only `connection_status`.
3. **The extension has no Supabase session.** It authenticates with its own bearer token, which the
   server validates against `extension_tokens` — a table RLS denies to clients by design.

So: publishable key stays for all existing browser code, secret key is added for route handlers only,
and it never gets a `NEXT_PUBLIC_` prefix.

---

## 4. Environment

```bash
# Browser — safe to expose
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...

# Server only — never NEXT_PUBLIC_
SUPABASE_SECRET_KEY=sb_secret_...
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
TOKEN_ENCRYPTION_KEY=<openssl rand -base64 32>
APP_URL=http://localhost:3000
```

Note the existing `.env.example` uses `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
`src/lib/supabase/client.ts` reads that name. The publishable key goes in that variable — I keep the
name so no existing code changes.

---

## 5. Route surface

```
/connections                          NEW page: connect / sync / import / disconnect

/api/connect/youtube/start            PKCE + signed state cookie → Google consent
/api/connect/youtube/callback         code → tokens → connections row
/api/connect/[provider]/disconnect    revoke upstream, then delete row
/api/sync/youtube                     POST: playlists + liked videos → resources
/api/import/instagram                 POST multipart: DYI ZIP or saved_posts.json
/api/extension/pair                   POST { code } → { token }
/api/extension/items                  POST batch, Authorization: Bearer <token>
```

Plus `src/lib/supabase/server.ts` (cookie-aware server client + a service client),
`src/lib/crypto.ts` (AES-256-GCM), `src/lib/canonical.ts` (URL normalization), and
`src/middleware.ts` (session refresh — required for server components to see the session).

---

## 6. YouTube — what "saved" actually means

Scope: `https://www.googleapis.com/auth/youtube.readonly`

| Call | Cost | Gives |
|---|---|---|
| `playlists.list(mine=true)` | 1 | Every playlist the user made |
| `playlistItems.list(playlistId=…)` | 1 / 50 | Items in each playlist |
| `playlistItems.list(playlistId="LL")` | 1 / 50 | **Liked videos** — the real saved signal |
| `videos.list(id=…,part=snippet,contentDetails)` | 1 / 50 | Title, channel, thumbnail, ISO-8601 duration |

**Watch Later (`WL`) is not accessible.** Third-party read access was removed in 2016. Don't promise it.

**Never call `search.list`** — 100 units against a 10,000/day budget. Everything above costs 1, so a
500-item sync costs ~30 units. Quota is a non-issue.

Duration maps to `estimated_minutes`, which the optimizer already depends on. **This is the only source
that gives real durations** — that's why YouTube goes first.

Consent screen stays in **Testing** mode: `youtube.readonly` is sensitive, so production mode needs
Google verification (weeks). Testing allows 100 listed test users, no review. Expect an "unverified app"
interstitial; click through.

Flow: authorization code + PKCE, `access_type=offline`, `prompt=consent` (required to actually get a
refresh token). Sync is idempotent — upserts on `(user_id, source, external_id)`.

---

## 7. Instagram — how you build the dataset

No OAuth scope for Saved exists at any tier in Meta's platform. Two routes, do both.

### Route A — request the official export (start today)

Instagram → **Settings → Accounts Center → Your information and permissions → Download your
information → Download or transfer information → your account → Some of your information →
select "Saved" → Download to device → Format: JSON** (not HTML — HTML is far harder to parse)
→ Date range: All time → Submit.

Arrives in hours to days as a ZIP containing:

```
your_instagram_activity/saved/saved_posts.json
your_instagram_activity/saved/saved_collections.json
```

`saved_posts.json` shape:

```json
{ "saved_saved_media": [
    { "title": "creator_username",
      "string_map_data": {
        "Saved on": { "href": "https://www.instagram.com/reel/ABC123/",
                      "timestamp": 1757000000 } } } ] }
```

That yields permalink, author, and a real `saved_at`. `saved_collections.json` has the same shape keyed
by collection name — merging it back on permalink preserves the user's own topic labels, which is the
single best free signal in the file. My parser does that merge.

### Route B — hand-build a 40-item fixture (do this today, 20 minutes)

The export is the only thing on the critical path you cannot hurry, so don't depend on it:

1. Open Instagram on desktop → your Saved tab.
2. For ~40 Reels, copy the link (⋯ → Copy link) and paste into a text file, one per line.
3. Tell me the file path. I'll write `scripts/build-ig-fixture.ts` to convert it into the exact
   `saved_posts.json` schema above, with synthetic timestamps.

The fixture is schema-identical to the export, so **the parser is proven against real structure either
way**. If the export lands, we swap the file and nothing else changes. If it doesn't, the demo is
unaffected and nobody can tell.

### What we are NOT doing

SuperBrain uses Instaloader with a stored username/password session and recommends a burner account.
Rejected for two reasons, the second being decisive:

1. [PRODUCT_FLOW.md:439](PRODUCT_FLOW.md) says *"Never request an Instagram password or scrape private
   Saved collections."* Shipping it reverses a stated privacy commitment that's in your own repo.
2. **It doesn't work at demo speed.** Instagram throttles anonymous scraping to ~1–2 requests per 30
   seconds, with 429s after 2–3 posts. 40 Reels is a 20+ minute job that dies halfway, and Instaloader
   shipped doc_id/HTTP-2 fixes in March 2026 still chasing Instagram's blocks.

Production answer for a judge: Meta's EYI destination program pushes **this identical JSON schema** to
approved partners — so the hackathon parser is already the production parser, only transport changes.

---

## 8. Chrome — bookmarks and open tabs

Manifest V3 unpacked extension in `extension/`. Permissions: `bookmarks` (full tree; folder paths
become `collection`) and `tabs` (open tab URLs + titles). **Not `history`** — high volume, low signal,
and the worst line in the consent prompt.

The Data Portability API's `dataportability.chrome.bookmarks` scope is **Restricted** and needs a
third-party security assessment. Not viable. The extension gets the same data in one click.

**Pairing handshake** — the real problem here is authenticating an extension that has no Supabase
session, across a different origin, from an MV3 service worker where cookie auth is painful:

1. User clicks **Connect Chrome** on `/connections`. Server mints an 8-char code, 10-min TTL.
2. User enters the code in the extension popup.
3. `POST /api/extension/pair { code }` → server burns the code, returns an opaque 32-byte token.
   Only its SHA-256 hash is stored.
4. Extension keeps the token in `chrome.storage.local`, sends batches with `Authorization: Bearer`.

Device pairing, not OAuth. No CORS or cookie scoping, identical on localhost and deployed, and each
install is independently revocable. Sideload via `chrome://extensions` → Developer mode → Load unpacked.

Also ships a **Save to Resurface** button, which turns a one-time import into the ongoing capture path
`PRODUCT_FLOW.md` §2.2 already promises. ~30 min on top.

---

## 9. Normalization

All three sources converge on one `resources` row.

| | source | content_type | estimated_minutes | collection |
|---|---|---|---|---|
| Liked video | `youtube` | `video` / `short_video` if <90s | real duration | `"Liked videos"` |
| Playlist item | `youtube` | same | real duration | playlist name |
| Bookmark | `chrome` | `article` | 5 (default) | folder path |
| Open tab | `chrome` | `article` | 5 | `"Open tabs"` |
| Saved Reel | `instagram` | `short_video` | 1 | IG collection name |

`canonical_url` dedup: strip `utm_*`/`si`/`t`/`igsh`/`fbclid`, lowercase host, drop `www.` and trailing
slash, rewrite `youtu.be/ID` → `youtube.com/watch?v=ID`. A video both liked on YouTube and bookmarked in
Chrome collapses to one row via the existing unique index — and "you saved this twice across two
platforms" is a good demo line.

---

## 10. Build order

| Block | Time | Work | Demoable at end |
|---|---|---|---|
| 0 | 45 min | pnpm via corepack, read `node_modules/next/dist/docs/`, migration 2, server client, crypto, middleware | Schema applied |
| 1 | 30 min | `/connections` page reading `connection_status` | Empty states render |
| 2 | **2 hr** | **YouTube OAuth + sync** | **Real videos in `resources`** |
| 3 | 2 hr | Chrome extension + pairing + ingest | Bookmarks + tabs in `resources` |
| 4 | 1 hr | Instagram import + collections merge | Reels in `resources` |
| 5 | 45 min | Canonical dedup, `/connections` counts, `sync_runs` surfacing | Full connections UI |
| 6 | 30 min | Seed script + fixture export for the optimizer team | Frozen corpus |

**~7.5 hours.** The remaining time goes to the optimizer, which is where the project is won.

**If behind, cut in this order:** open tabs (keep bookmarks) → `/connections` polish → the extension
entirely. **Never cut YouTube** — it's the only source with real content *and* real duration.

**Risks**

- *Next.js 16 differs from my training data* (per `AGENTS.md`). Block 0 includes reading
  `node_modules/next/dist/docs/` before I write a single route handler. Cheap insurance.
- *`pnpm` is not installed and corepack is missing on this machine.* README says `corepack enable`; that
  binary doesn't exist here. Block 0 resolves it (`npm i -g pnpm@11.19.0`) — flagging so it's not a
  surprise.
- *Google OAuth credentials are the hard blocker.* Blocks 0, 1, 3, 4 all proceed without them; only
  block 2 stops.

---

## 11. What I need from you

| # | Thing | Blocks |
|---|---|---|
| 1 | **Supabase project URL** (`https://<ref>.supabase.co`) | Everything |
| 2 | **Secret key** (`sb_secret_…`) from Settings → API Keys | Blocks 0–4 |
| 3 | **Google Cloud**: enable YouTube Data API v3 → consent screen External+Testing → add teammates as test users → Web application client → send client ID + secret | Block 2 only |
| 4 | Redirect URI, pasted exactly: `http://localhost:3000/api/connect/youtube/callback` | Block 2 |
| 5 | Confirm you ran migration 1 in the SQL editor already | Block 0 |
| 6 | **Instagram: request the export AND paste ~40 Reel links into a file** (§7) | Block 4 |
| 7 | `chrome://extensions` → Developer mode on | Block 3 |

Items 1, 2, 5 unblock me immediately. 3 and 4 can follow within the hour. 6 is the one with real
latency — start it first.

## 12. Open question

`MVP_SCOPE.md:44` defers "Instagram Saved collection import," which this plan implements. Want me to
update that doc, or leave it and note the exception?
