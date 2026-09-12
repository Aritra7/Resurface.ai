import Link from "next/link";

const steps = [
  {
    number: "01",
    title: "Save from anywhere",
    description: "Bring in a Reel, video, newsletter, or article with one link.",
  },
  {
    number: "02",
    title: "Tell us what matters",
    description: "Choose your current goals and how much time you have.",
  },
  {
    number: "03",
    title: "Get the right queue",
    description: "Resurface builds a useful, varied session that fits your time.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden">
      <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6 lg:px-8">
        <Link className="text-lg font-semibold tracking-tight" href="/">
          Resurface<span className="text-[var(--accent)]">.AI</span>
        </Link>
        <Link
          className="rounded-full border border-[var(--border)] bg-white px-4 py-2 text-sm font-medium transition hover:border-[var(--accent)]"
          href="/login"
        >
          Sign in
        </Link>
      </nav>

      <section className="mx-auto grid w-full max-w-6xl gap-12 px-6 pb-20 pt-16 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:px-8 lg:pb-28 lg:pt-24">
        <div>
          <p className="mb-5 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
            Your saved list, finally useful
          </p>
          <h1 className="max-w-3xl text-5xl font-semibold leading-[1.02] tracking-[-0.045em] sm:text-6xl lg:text-7xl">
            The right save at the right time.
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-8 text-[var(--muted)]">
            Resurface turns forgotten bookmarks into focused sessions built around
            your goals, your energy, and the time you actually have.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-[var(--accent)] px-6 py-3 font-semibold text-white transition hover:bg-[var(--accent-hover)]"
              href="/onboarding"
            >
              Get started
            </Link>
            <Link
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-[var(--border)] bg-white px-6 py-3 font-semibold transition hover:border-[var(--accent)]"
              href="/demo"
            >
              Try with sample saves
            </Link>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-md">
          <div className="absolute -left-16 -top-14 h-40 w-40 rounded-full bg-[#d8edcf] blur-3xl" />
          <div className="relative rounded-[2rem] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_28px_80px_rgba(40,65,46,0.12)]">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Your next session
                </p>
                <p className="mt-1 text-xl font-semibold">10 focused minutes</p>
              </div>
              <span className="rounded-full bg-[#e4f2df] px-3 py-1 text-sm font-semibold text-[var(--accent)]">
                3 saves
              </span>
            </div>
            <div className="space-y-3 pt-4">
              <ResourcePreview
                category="Programming"
                time="6 min"
                title="Understanding OAuth visually"
              />
              <ResourcePreview
                category="Fitness"
                time="1 min"
                title="A better shoulder warm-up"
              />
              <ResourcePreview
                category="Career"
                time="3 min"
                title="The newsletter idea you saved"
              />
            </div>
            <p className="mt-5 rounded-2xl bg-[#f2f4ee] px-4 py-3 text-sm leading-6 text-[var(--muted)]">
              Chosen because these fit your time, support active goals, and avoid
              repeating the same topic.
            </p>
          </div>
        </div>
      </section>

      <section className="border-y border-[var(--border)] bg-white">
        <div className="mx-auto grid w-full max-w-6xl gap-px px-6 py-4 md:grid-cols-3 lg:px-8">
          {steps.map((step) => (
            <article className="py-7 md:px-6 md:first:pl-0" key={step.number}>
              <p className="text-xs font-semibold tracking-wider text-[var(--accent)]">
                {step.number}
              </p>
              <h2 className="mt-3 text-lg font-semibold">{step.title}</h2>
              <p className="mt-2 max-w-xs text-sm leading-6 text-[var(--muted)]">
                {step.description}
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function ResourcePreview({
  category,
  time,
  title,
}: {
  category: string;
  time: string;
  title: string;
}) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-[var(--border)] p-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#edf0e8] text-sm font-bold text-[var(--accent)]">
        {time.split(" ")[0]}
      </div>
      <div className="min-w-0">
        <p className="truncate font-medium">{title}</p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {category} · {time}
        </p>
      </div>
    </div>
  );
}
