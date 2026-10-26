import { BRAND } from "@/lib/brand";
export default function Home() {
  return (
    <main className="shell-wrap flex flex-1 flex-col items-start justify-center gap-4 py-16">
      <p className="text-sm font-medium uppercase tracking-widest text-brand-700">
        South Australian independent artists
      </p>
      <h1 className="max-w-xl text-4xl font-semibold leading-tight tracking-tight">
        A home for South Australian artists.
      </h1>
      <p className="max-w-xl text-lg leading-8 text-muted">
        Create your artist profile and share your work on {BRAND.name}.
      </p>
    </main>
  );
}
