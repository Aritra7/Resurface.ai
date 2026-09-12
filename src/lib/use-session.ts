"use client";

/**
 * Keeps a page in step with the Supabase session.
 *
 * proxy.ts rotates the auth cookie on every request, but a client component that calls
 * getUser() once on mount never learns about anything that happens afterwards: a token
 * refresh, a sign-out in another tab, or a session restored after the laptop wakes.
 * Without this, pages redirect to /login while the user is still perfectly signed in.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "./supabase/client";

export type SessionState = {
  user: User | null;
  /** True until the first auth check resolves. Render a loading state, not a redirect. */
  loading: boolean;
};

export function useSession(options: { redirectTo?: string } = {}): SessionState {
  const { redirectTo = "/login" } = options;
  const router = useRouter();
  const [state, setState] = useState<SessionState>({ user: null, loading: true });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    void (async () => {
      // getUser() verifies with the auth server rather than trusting a local token.
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!data.user) {
        router.replace(redirectTo);
        setState({ user: null, loading: false });
        return;
      }
      setState({ user: data.user, loading: false });
    })();

    // Fires on TOKEN_REFRESHED, SIGNED_OUT and SIGNED_IN, including from another tab.
    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;

      if (event === "SIGNED_OUT") {
        setState({ user: null, loading: false });
        router.replace(redirectTo);
        return;
      }

      // A refresh hands us a new token for the same user: update, never redirect.
      if (session?.user) setState({ user: session.user, loading: false });
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [router, redirectTo]);

  return state;
}
