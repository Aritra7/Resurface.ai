"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");

    const supabase = createClient();
    const result =
      mode === "signup"
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });

    setPending(false);
    if (result.error) {
      setMessage(result.error.message);
      return;
    }

    if (mode === "signup" && !result.data.session) {
      setMessage("Check your email to confirm your account, then return to sign in.");
      return;
    }

    router.replace(mode === "signup" ? "/onboarding" : "/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <section className="w-full max-w-md rounded-[2rem] border border-[var(--border)] bg-white p-7 shadow-[0_24px_70px_rgba(40,65,46,0.1)] sm:p-9">
        <Link className="text-lg font-semibold" href="/">
          Resurface<span className="text-[var(--accent)]">.AI</span>
        </Link>
        <p className="mt-8 text-sm font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
          {mode === "signup" ? "Create your profile" : "Welcome back"}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          {mode === "signup" ? "Start rescuing your saves." : "Continue where you left off."}
        </h1>
        <p className="mt-3 leading-7 text-[var(--muted)]">
          {mode === "signup"
            ? "Your account keeps goals, preferences, and revisit history together."
            : "Sign in to open your saved-resource queue."}
        </p>

        <form className="mt-7 space-y-5" onSubmit={submit}>
          <label className="block text-sm font-medium" htmlFor="email">
            Email
            <input
              autoComplete="email"
              className="mt-2 min-h-12 w-full rounded-xl border border-[var(--border)] px-4 text-base"
              id="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label className="block text-sm font-medium" htmlFor="password">
            Password
            <input
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              className="mt-2 min-h-12 w-full rounded-xl border border-[var(--border)] px-4 text-base"
              id="password"
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>

          {message && (
            <p aria-live="polite" className="rounded-xl bg-[#f2f4ee] px-4 py-3 text-sm leading-6">
              {message}
            </p>
          )}

          <button
            className="min-h-12 w-full rounded-full bg-[var(--accent)] px-5 font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={pending}
            type="submit"
          >
            {pending ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>

        <button
          className="mt-5 w-full text-sm font-medium text-[var(--accent)]"
          onClick={() => {
            setMode(mode === "signup" ? "signin" : "signup");
            setMessage("");
          }}
          type="button"
        >
          {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
        </button>
      </section>
    </main>
  );
}
