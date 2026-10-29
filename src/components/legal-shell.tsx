import Link from "next/link";
import type { ReactNode } from "react";

type Section = {
  id: string;
  title: string;
  body: ReactNode;
};

type Props = {
  eyebrow: string;
  title: string;
  lead: string;
  meta: string[];
  sections: Section[];
};

/**
 * Shared layout for /about, /privacy, /terms, /licence and /credits:
 * editorial masthead, sticky table of contents on desktop, numbered
 * sections in readable measure, and a cross-link bar at the foot.
 */
export function LegalShell({ eyebrow, title, lead, meta, sections }: Props) {
  return (
    <main className="shell-wrap py-12 lg:py-20">
      <header className="border-b border-line pb-10">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">
          {eyebrow}
        </p>
        <h1 className="mt-4 max-w-3xl font-display text-5xl leading-[1.04] tracking-tight md:text-[64px]">
          {title}
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-muted">{lead}</p>
        <ul className="mt-6 flex flex-wrap gap-x-8 gap-y-2 border-t border-line pt-4 font-mono text-xs text-muted">
          {meta.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </header>

      <div className="mt-12 grid gap-12 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-16">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted">
            Contents
          </p>
          <ol className="mt-4 space-y-2 border-l border-line pl-4 text-sm">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="block py-1 text-muted transition-colors hover:text-foreground"
                >
                  <span className="mr-2 font-mono text-xs">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </aside>

        <div className="max-w-2xl space-y-12">
          {sections.map((s, i) => (
            <section
              key={s.id}
              id={s.id}
              className="scroll-mt-24 border-b border-line pb-10 last:border-b-0"
            >
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted">
                Section {String(i + 1).padStart(2, "0")}
              </p>
              <h2 className="mt-2 font-display text-[28px] leading-tight md:text-[32px]">
                {s.title}
              </h2>
              <div className="mt-4 space-y-4 text-sm leading-7 text-muted [&_code]:border [&_code]:border-line [&_code]:bg-surface [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_code]:text-foreground [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
                {s.body}
              </div>
            </section>
          ))}
        </div>
      </div>

      <nav
        aria-label="Platform policies and information"
        className="mt-14 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-6 font-mono text-xs uppercase tracking-[0.14em] text-muted"
      >
        <Link href="/about" className="hover:text-foreground">
          About
        </Link>
        <Link href="/privacy" className="hover:text-foreground">
          Privacy
        </Link>
        <Link href="/terms" className="hover:text-foreground">
          Terms
        </Link>
        <Link href="/licence" className="hover:text-foreground">
          Content Licence
        </Link>
        <Link href="/credits" className="hover:text-foreground">
          Credits
        </Link>
        <Link href="/" className="ml-auto text-foreground underline underline-offset-4">
          ← Back to {title.includes("Happenfolk") ? "home" : "Happenfolk"}
        </Link>
      </nav>
    </main>
  );
}
