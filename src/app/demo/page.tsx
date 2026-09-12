import Link from "next/link";

const sampleSaves = [
  { source: "Instagram Reel", title: "5-minute shoulder mobility", goal: "Improve fitness", time: "1 min" },
  { source: "YouTube", title: "OAuth explained visually", goal: "Learn something", time: "6 min" },
  { source: "Newsletter", title: "How to validate a product idea", goal: "Grow my career", time: "3 min" },
];

export default function DemoPage() {
  return (
    <main className="min-h-screen px-5 py-10">
      <div className="mx-auto max-w-3xl">
        <Link className="text-lg font-semibold" href="/">Resurface<span className="text-[var(--accent)]">.AI</span></Link>
        <section className="mt-12 rounded-[2rem] border border-[var(--border)] bg-white p-7 shadow-[0_20px_60px_rgba(40,65,46,0.07)] sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Sample 10-minute session</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Three saves worth seeing again</h1>
          <p className="mt-3 leading-7 text-[var(--muted)]">The optimizer balances goal relevance, available time, variety, and how long a save has been waiting.</p>
          <div className="mt-7 space-y-3">
            {sampleSaves.map((save, index) => (
              <article className="flex gap-4 rounded-2xl border border-[var(--border)] p-5" key={save.title}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#edf0e8] font-semibold text-[var(--accent)]">{index + 1}</span>
                <div>
                  <h2 className="font-semibold">{save.title}</h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">{save.source} · {save.goal} · {save.time}</p>
                </div>
              </article>
            ))}
          </div>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link className="inline-flex min-h-12 items-center justify-center rounded-full bg-[var(--accent)] px-6 font-semibold text-white" href="/session/new">Try the optimizer</Link>
            <Link className="inline-flex min-h-12 items-center justify-center rounded-full border border-[var(--border)] px-6 font-semibold" href="/login">Create my profile</Link>
          </div>
        </section>
      </div>
    </main>
  );
}
