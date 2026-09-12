"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/use-session";
import { AppHeader } from "@/components/app-header";

type Connection = {
  id: string;
  provider: string;
  external_account_label: string | null;
  status: string;
  last_sync_at: string | null;
  items_count: number;
  last_error: string | null;
};

type ConnectionsData = {
  connections: Connection[];
  counts: Record<string, number>;
  totalResources: number;
  pendingEnrichment: number;
  instagramEnriched: number;
  youtubeConfigured: boolean;
};

/** OAuth failures arrive as redirect params. Never show the raw code to a user. */
const ERROR_COPY: Record<string, string> = {
  access_denied:
    "Google did not complete the sign-in. If you did not cancel, this Google account may "
    + "not be on the app's allowed testers list yet.",
  not_a_test_user:
    "This Google account is not on the app's allowed testers list. The owner needs to add "
    + "your Google address under APIs & Services -> OAuth consent screen -> Test users.",
  oauth_error: "Google rejected the sign-in. Please try again.",
  youtube_not_configured:
    "YouTube is not configured on the server yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
  missing_oauth_params: "That sign-in link was incomplete. Please try connecting again.",
  state_mismatch: "The sign-in could not be verified. Please try again from this page.",
  token_exchange_failed: "Google rejected the sign-in. Please try again.",
  no_refresh_token:
    "Google did not return a refresh token. Remove Resurface at myaccount.google.com/permissions, then reconnect.",
  connection_save_failed: "We could not save the connection. Please try again.",
};

function ConnectionsInner() {
  const router = useRouter();
  const params = useSearchParams();
  // Without this the page redirects to /login whenever a token refresh lands mid-visit.
  const { user, loading: sessionLoading } = useSession();

  const [data, setData] = useState<ConnectionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pairingCode, setPairingCode] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/connections");
    if (response.status === 401) {
      router.replace("/login");
      return;
    }
    setData(await response.json());
    setLoading(false);
  }, [router]);

  useEffect(() => {
    if (sessionLoading || !user) return;

    // Deferred rather than called synchronously: React 19 flags a synchronous setState
    // in an effect body because it cascades renders. The fetch resolving later is what
    // actually updates state, and the guard drops a response that arrives post-unmount.
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/connections");
      if (cancelled) return;
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      const body = await response.json();
      if (cancelled) return;
      setData(body);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, user, sessionLoading]);

  // Derived from the URL rather than copied into state, so the redirect message and any
  // message set by a later action (sync, disconnect) cannot fight over the same slot.
  const errorParam = params.get("error");
  const redirectError = errorParam
    ? (ERROR_COPY[errorParam] ?? "Something went wrong connecting that account.")
    : "";
  const redirectNotice =
    params.get("connected") === "youtube" ? "YouTube connected. Import your saved videos below." : "";

  const shownError = error || redirectError;
  const shownNotice = notice || (error ? "" : redirectNotice);

  async function syncYouTube() {
    setBusy("youtube");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/sync/youtube", { method: "POST" });
      const body = await response.json();
      if (!response.ok) {
        const raw = body.error ?? "";
        // Translate the two failures that are really server misconfiguration, so they
        // point at the fix instead of reading like something the user did wrong.
        setError(
          /invalid api key|jwt|apikey/i.test(raw)
            ? "The server's Supabase key is missing or wrong. Set SUPABASE_SECRET_KEY in the deployment environment and redeploy."
            : /has not been used in project|is disabled/i.test(raw)
              ? "YouTube Data API v3 is not enabled on your Google Cloud project. Enable it, then sync again."
              : raw || "Sync failed.",
        );
      } else {
        setNotice(
          body.seen === 0
            ? "No playlist videos found. Save some videos into a YouTube playlist, then import again."
            : `Imported ${body.imported} of ${body.seen} playlist videos.`,
        );
      }
    } catch {
      setError("Sync failed. Is the dev server still running?");
    }
    setBusy(null);
    load();
  }

  async function importInstagram(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setBusy("instagram");
    setError("");
    setNotice("");

    const body = new FormData();
    for (const file of Array.from(files)) body.append("files", file);

    try {
      const response = await fetch("/api/import/instagram", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "Import failed.");
      } else {
        const warnings = result.warnings?.length ? ` (${result.warnings.join(" ")})` : "";
        setNotice(`Imported ${result.imported} of ${result.seen} saved posts.${warnings}`);
      }
    } catch {
      setError("Import failed. Is the dev server still running?");
    }

    // Let the same file be picked again after a failed attempt.
    event.target.value = "";
    setBusy(null);
    load();
  }

  async function createPairingCode() {
    setBusy("chrome");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/extension/code", { method: "POST" });
      const body = await response.json();
      if (!response.ok) setError(body.error ?? "Could not create a pairing code.");
      else setPairingCode(body.code);
    } catch {
      setError("Could not reach the server.");
    }
    setBusy(null);
  }

  async function enrichPending() {
    setBusy("enrich");
    setError("");
    setNotice("");
    try {
      // The route works in bounded batches so no single request runs too long; loop
      // until nothing is left rather than making the user click repeatedly.
      let enriched = 0;
      let remaining = 0;
      for (let pass = 0; pass < 25; pass += 1) {
        const response = await fetch("/api/enrich", { method: "POST" });
        const body = await response.json();
        if (!response.ok) {
          setError(body.error ?? "Enrichment failed.");
          break;
        }
        enriched += body.enriched ?? 0;
        remaining = body.remaining ?? 0;
        if ((body.processed ?? 0) === 0 || remaining === 0) break;
      }
      setNotice(
        enriched > 0
          ? `Added titles and thumbnails to ${enriched} ${enriched === 1 ? "item" : "items"}.`
          : "Nothing left to enrich.",
      );
    } catch {
      setError("Enrichment failed. Is the dev server still running?");
    }
    setBusy(null);
    load();
  }

  async function disconnect(provider: string) {
    if (!confirm(`Disconnect ${provider}? Your imported saves are kept.`)) return;
    setBusy(provider);
    // Check the response. Reporting success unconditionally hid real failures: with a
    // bad server key the request 500s, the connection survives, and the UI still said
    // "disconnected" while the card stayed connected.
    try {
      const response = await fetch(`/api/connect/${provider}/disconnect`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? `Could not disconnect ${provider}. Please try again.`);
      } else {
        setNotice(`${provider} disconnected.`);
      }
    } catch {
      setError(`Could not reach the server to disconnect ${provider}.`);
    }

    setBusy(null);
    load();
  }


  if (sessionLoading || loading) {
    return <main className="flex min-h-screen items-center justify-center">Loading your connections…</main>;
  }

  const youtube = data?.connections.find((c) => c.provider === "youtube");
  const chrome = data?.connections.find((c) => c.provider === "browser_bookmark");

  return (
    <main className="min-h-screen px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <AppHeader current="connections" />

        <section className="mt-12">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Connections</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Bring in what you already saved.</h1>
          <p className="mt-4 max-w-xl text-lg leading-8 text-[var(--muted)]">
            Connect a platform once and Resurface imports your saves. You can disconnect at any time
            and keep everything already imported.
          </p>
        </section>

        {shownNotice && (
          <p aria-live="polite" className="mt-8 rounded-2xl border border-[var(--accent)] bg-[#e8f2ea] px-5 py-4 text-sm leading-6">
            {shownNotice}
          </p>
        )}
        {shownError && (
          <p aria-live="polite" className="mt-8 rounded-2xl border border-[#d9b4b4] bg-[#f8efef] px-5 py-4 text-sm leading-6">
            {shownError}
          </p>
        )}

        <section className="mt-8 space-y-4">
          {/* YouTube */}
          <article className="scroll-mt-8 rounded-[2rem] border border-[var(--border)] bg-white p-7" id="youtube">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold">YouTube</h2>
                <p className="mt-2 max-w-md leading-7 text-[var(--muted)]">
                  Imports videos you saved into playlists, with real durations. Playlist
                  names become topic labels.
                </p>
              </div>
              <StatusPill connected={Boolean(youtube)} status={youtube?.status} />
            </div>

            {youtube ? (
              <>
                <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-[var(--border)] pt-5 text-sm sm:grid-cols-3">
                  <Stat label="Account" value={youtube.external_account_label ?? "Connected"} />
                  <Stat label="Videos imported" value={String(data?.counts.youtube ?? 0)} />
                  <Stat
                    label="Last sync"
                    value={youtube.last_sync_at ? new Date(youtube.last_sync_at).toLocaleString() : "Never"}
                  />
                </dl>
                {youtube.last_error && (
                  <p className="mt-4 rounded-xl bg-[#f8efef] px-4 py-3 text-sm">{youtube.last_error}</p>
                )}
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    className="min-h-12 rounded-full bg-[var(--accent)] px-6 font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-60"
                    disabled={busy === "youtube"}
                    onClick={syncYouTube}
                    type="button"
                  >
                    {busy === "youtube" ? "Importing…" : "Import playlist videos"}
                  </button>
                  <button
                    className="min-h-12 rounded-full border border-[var(--border)] px-6 font-semibold transition hover:border-[var(--accent)] disabled:opacity-60"
                    disabled={busy === "youtube"}
                    onClick={() => disconnect("youtube")}
                    type="button"
                  >
                    Disconnect
                  </button>
                </div>
              </>
            ) : (
              <div className="mt-6">
                {data?.youtubeConfigured ? (
                  // A plain link, not fetch(): the server must issue a real redirect to
                  // Google, and set the PKCE and state cookies on the way out.
                  <a
                    className="inline-flex min-h-12 items-center rounded-full bg-[var(--accent)] px-6 font-semibold text-white transition hover:bg-[var(--accent-hover)]"
                    href="/api/connect/youtube/start"
                  >
                    Connect YouTube
                  </a>
                ) : (
                  <p className="rounded-xl bg-[#f2f4ee] px-4 py-3 text-sm leading-6">
                    YouTube is not configured on the server yet.
                  </p>
                )}
                <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
                  Google will show an &ldquo;unverified app&rdquo; warning because this build is in
                  testing mode. Choose <strong>Advanced</strong>, then <strong>Go to Resurface</strong>.
                </p>
              </div>
            )}
          </article>

          {/* Chrome */}
          <article className="scroll-mt-8 rounded-[2rem] border border-[var(--border)] bg-white p-7" id="chrome">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold">Chrome bookmarks &amp; tabs</h2>
                <p className="mt-2 max-w-md leading-7 text-[var(--muted)]">
                  A browser extension sends your bookmark folders and open tabs. Folder names
                  become topic labels.
                </p>
              </div>
              <StatusPill connected={Boolean(chrome)} status={chrome?.status} />
            </div>

            {chrome && (
              <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-[var(--border)] pt-5 text-sm sm:grid-cols-3">
                <Stat label="Browser" value={chrome.external_account_label ?? "Chrome"} />
                <Stat label="Links imported" value={String(data?.counts.browser_bookmark ?? 0)} />
                <Stat
                  label="Last sync"
                  value={chrome.last_sync_at ? new Date(chrome.last_sync_at).toLocaleString() : "Never"}
                />
              </dl>
            )}

            <div className="mt-6">
              <button
                className="min-h-12 rounded-full bg-[var(--accent)] px-6 font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-60"
                disabled={busy === "chrome"}
                onClick={createPairingCode}
                type="button"
              >
                {busy === "chrome" ? "Generating…" : chrome ? "Pair another browser" : "Connect Chrome"}
              </button>

              {pairingCode && (
                <div className="mt-5 rounded-2xl border border-[var(--accent)] bg-[#e8f2ea] px-5 py-4">
                  <p className="text-sm text-[var(--muted)]">
                    Enter this code in the Resurface extension popup. It expires in 10 minutes.
                  </p>
                  <p className="mt-2 font-mono text-3xl font-semibold tracking-[0.3em]">
                    {pairingCode}
                  </p>
                </div>
              )}

              <details className="mt-5 text-sm leading-6 text-[var(--muted)]">
                <summary className="cursor-pointer font-medium text-[var(--foreground)]">
                  First time? Install the extension
                </summary>
                <ol className="mt-3 list-decimal space-y-1 pl-5">
                  <li>Open <code>chrome://extensions</code></li>
                  <li>Turn on <strong>Developer mode</strong> (top right)</li>
                  <li>Click <strong>Load unpacked</strong></li>
                  <li>Select the <code>extension</code> folder in this project</li>
                  <li>Click <strong>Connect Chrome</strong> above, then enter the code in the popup</li>
                </ol>
              </details>
            </div>
          </article>

          {/* Instagram - import only, never credentials */}
          <article className="scroll-mt-8 rounded-[2rem] border border-[var(--border)] bg-white p-7" id="instagram">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold">Instagram</h2>
                <p className="mt-2 max-w-md leading-7 text-[var(--muted)]">
                  Upload the Saved files from your Instagram data export. We never ask for your
                  Instagram password and never scrape your Saved page.
                </p>
              </div>
              <StatusPill connected={(data?.counts.instagram ?? 0) > 0} status="active" />
            </div>

            {(data?.counts.instagram ?? 0) > 0 && (
              <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-[var(--border)] pt-5 text-sm sm:grid-cols-3">
                <Stat label="Posts imported" value={String(data?.counts.instagram ?? 0)} />
                <Stat label="With details" value={String(data?.instagramEnriched ?? 0)} />
                <Stat label="Source" value="Data export" />
              </dl>
            )}

            <div className="mt-6">
              <label
                className="inline-flex min-h-12 cursor-pointer items-center rounded-full bg-[var(--accent)] px-6 font-semibold text-white transition hover:bg-[var(--accent-hover)]"
                htmlFor="ig-upload"
              >
                {busy === "instagram" ? "Importing…" : "Upload saved posts"}
              </label>
              <input
                accept=".json,.txt"
                className="sr-only"
                disabled={busy === "instagram"}
                id="ig-upload"
                multiple
                onChange={importInstagram}
                type="file"
              />
              <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
                Select <code>saved_posts.json</code> (and <code>saved_collections.json</code> if you
                have it) from <code>your_instagram_activity/saved/</code>. A plain text file of Reel
                links works too.
              </p>
            </div>
          </article>
        </section>

        <section className="mt-8 rounded-[2rem] border border-[var(--border)] bg-white p-7 text-center">
          <p className="text-lg font-semibold">
            {data?.totalResources ?? 0} saved{" "}
            {data?.totalResources === 1 ? "resource" : "resources"} in your backlog
          </p>
          {(data?.pendingEnrichment ?? 0) > 0 ? (
            <>
              <p className="mx-auto mt-2 max-w-md leading-7 text-[var(--muted)]">
                {data?.pendingEnrichment} still need a title. We read only the public preview
                information each platform publishes for links.
              </p>
              <button
                className="mt-5 min-h-12 rounded-full bg-[var(--accent)] px-6 font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-60"
                disabled={busy === "enrich"}
                onClick={enrichPending}
                type="button"
              >
                {busy === "enrich" ? "Fetching details…" : "Fetch titles and thumbnails"}
              </button>
            </>
          ) : (
            <p className="mt-2 leading-7 text-[var(--muted)]">
              Every resource has its details. You are ready to build a session.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

function StatusPill({ connected, status }: { connected: boolean; status?: string }) {
  if (!connected) {
    return (
      <span className="rounded-full bg-[#edf0e8] px-3 py-1.5 text-sm font-medium text-[var(--muted)]">
        Not connected
      </span>
    );
  }
  const broken = status === "error" || status === "expired";
  return (
    <span
      className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
        broken ? "bg-[#f8efef] text-[#9b4444]" : "bg-[#e4f2df] text-[var(--accent)]"
      }`}
    >
      {broken ? "Needs attention" : "Connected"}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 font-semibold">{value}</dd>
    </div>
  );
}

export default function ConnectionsPage() {
  // useSearchParams needs a Suspense boundary during prerender.
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center">Loading…</main>}>
      <ConnectionsInner />
    </Suspense>
  );
}
