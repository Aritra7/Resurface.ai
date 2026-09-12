"use client";

/**
 * Keeps a page in step with the Supabase session.
 *
 * proxy.ts rotates the auth cookie when necessary. The browser client is the source of
 * truth for interactive page state: getSession() restores (and refreshes) the cookie-
 * backed session without turning a temporary user-profile lookup failure into a logout.
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
      // This is UI state, not authorization. Database RLS and server routes still
      // validate every operation. getSession() also refreshes an expired access token.
      const { data, error } = await supabase.auth.getSession();
      if (cancelled) return;
      if (error || !data.session?.user) {
        router.replace(redirectTo);
        setState({ user: null, loading: false });
        return;
      }
      setState({ user: data.session.user, loading: false });
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
