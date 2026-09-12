"use client";

/**
 * Header for signed-in pages.
 *
 * The logo points at /dashboard rather than /, because inside the app "home" is the
 * dashboard. Linking to / sent signed-in users to the marketing page, which shows a
 * "Sign in" button and reads as having been logged out.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function AppHeader({ current }: { current?: "dashboard" | "connections" | "add" }) {
  const router = useRouter();

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/");
  }

  return (
    <header className="flex items-center justify-between gap-4">
      <Link className="text-lg font-semibold" href="/dashboard">
        Resurface<span className="text-[var(--accent)]">.AI</span>
      </Link>
      <nav className="flex items-center gap-5">
        {current !== "add" && (
          <Link
            className="text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            href="/add"
          >
            Add a save
          </Link>
        )}
        {current !== "dashboard" && (
          <Link
            className="text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            href="/dashboard"
          >
            Dashboard
          </Link>
        )}
        {current !== "connections" && (
          <Link
            className="text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            href="/connections"
          >
            Connections
          </Link>
        )}
        <button
          className="text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
          onClick={signOut}
          type="button"
        >
          Sign out
        </button>
      </nav>
    </header>
  );
}
