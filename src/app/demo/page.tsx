"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { createDemoResources } from "@/features/recommendations/demo-fixtures";

const sectionStyles = ["bg-[#e9f3e5]", "bg-[#fff4db]", "bg-[#e9eef8]", "bg-[#f1e8f5]"];

export default function DemoPage() {
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const resources = useMemo(() => createDemoResources(new Date().toISOString()), []);
  const sections = useMemo(() => {
    const grouped = new Map<string, { objective: string; resources: typeof resources }>();
    for (const resource of resources) {
      const name = resource.section ?? "Explore your saves";
      const current = grouped.get(name);
      if (current) current.resources.push(resource);
      else grouped.set(name, { objective: resource.objective ?? "Turn your saves into useful progress.", resources: [resource] });
    }
    return [...grouped.entries()].map(([name, value], index) => ({ name, ...value, color: sectionStyles[index % sectionStyles.length] }));
  }, [resources]);

  const active = sections.find((section) => section.name === selectedSection);

  return (
    <main className="min-h-screen px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between">
          <Link className="text-lg font-semibold" href="/">Resurface<span className="text-[var(--accent)]">.AI</span></Link>
          <span className="rounded-full bg-[#e9f3e5] px-3 py-1 text-xs font-semibold text-[var(--accent)]">Sample library</span>
        </header>

        <section className="mt-12 max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">AI-organized resource library</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">Your saves, turned into a learning path.</h1>
          <p className="mt-5 text-lg leading-8 text-[var(--muted)]">We grouped {resources.length} sample saves by the outcome they support. Choose a section, then choose how much time and energy you have.</p>
        </section>

        <section className="mt-10 grid gap-4 md:grid-cols-2">
          {sections.map((section, index) => (
            <button
              aria-pressed={selectedSection === section.name}
              className={`rounded-[1.75rem] border p-6 text-left transition hover:-translate-y-0.5 hover:border-[var(--accent)] ${selectedSection === section.name ? "border-[var(--accent)] ring-2 ring-[#c7e8bb]" : "border-[var(--border)]"} ${section.color}`}
              key={section.name}
              onClick={() => setSelectedSection(section.name)}
              type="button"
            >
              <div className="flex items-start justify-between gap-4"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/80 font-bold text-[var(--accent)]">0{index + 1}</span><span className="rounded-full bg-white/70 px-3 py-1 text-xs font-semibold">{section.resources.length} saves</span></div>
              <h2 className="mt-6 text-2xl font-semibold">{section.name}</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]"><strong>Outcome:</strong> {section.objective}</p>
              <div className="mt-5 flex flex-wrap gap-2">{section.resources.slice(0, 3).map((resource) => <span className="rounded-full bg-white/75 px-3 py-1.5 text-xs font-medium" key={resource.id}>{resource.title}</span>)}</div>
            </button>
          ))}
        </section>

        {active && (
          <section className="mt-8 rounded-[2rem] border border-[var(--accent)] bg-white p-6 shadow-[0_20px_60px_rgba(40,65,46,0.08)] sm:p-8">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Section selected</p><h2 className="mt-2 text-3xl font-semibold">{active.name}</h2><p className="mt-2 text-[var(--muted)]">{active.objective}</p></div><Link className="inline-flex min-h-12 items-center justify-center rounded-full bg-[var(--accent)] px-6 font-semibold text-white" href={`/session/new?section=${encodeURIComponent(active.name)}`}>Choose this session <span className="ml-3 text-xl">→</span></Link></div>
            <div className="mt-7 grid gap-3 sm:grid-cols-2">{active.resources.map((resource) => <article className="rounded-2xl border border-[var(--border)] p-4" key={resource.id}><div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{resource.source} · {resource.estimatedMinutes} min</span><span className="text-xs text-[var(--accent)]">AI match</span></div><h3 className="mt-2 font-semibold">{resource.title}</h3><p className="mt-1 text-sm text-[var(--muted)]">Selected because it supports this section outcome.</p></article>)}</div>
          </section>
        )}

        {!active && <p className="mt-8 text-center text-sm text-[var(--muted)]">Select a section to preview its saves and choose that session.</p>}
      </div>
    </main>
  );
}
