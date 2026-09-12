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

type AppRoute = "dashboard" | "resources" | "path" | "progress" | "connections" | "add";

const PRIMARY_LINKS: Array<{ href: string; label: string; route: AppRoute }> = [
  { href: "/dashboard", label: "Dashboard", route: "dashboard" },
  { href: "/resources", label: "Resources", route: "resources" },
  { href: "/path", label: "My path", route: "path" },
  { href: "/progress", label: "Progress", route: "progress" },
];

export function AppHeader({ current }: { current?: AppRoute }) {
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
      <nav className="hidden items-center gap-5 md:flex">
        {PRIMARY_LINKS.filter((link) => link.route !== current).map((link) => (
          <Link className="text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]" href={link.href} key={link.href}>{link.label}</Link>
        ))}
        {current !== "add" && (
          <Link
            className="text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            href="/add"
          >
            Add a save
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
