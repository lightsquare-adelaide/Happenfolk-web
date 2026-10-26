export default function ArtistLoading() {
  return (
    <main role="status" aria-busy="true" className="mx-auto w-full max-w-7xl px-5 py-10 sm:px-8 lg:py-16">
      <span className="sr-only">Loading artist profile…</span>
      <div aria-hidden="true" className="motion-safe:animate-pulse">
        <div className="h-5 w-36 bg-tint" />
        <div className="mt-5 h-16 w-3/4 max-w-xl bg-tint" />
        <div className="mt-8 h-px bg-line" />
        <div className="mt-10 h-20 max-w-2xl bg-tint" />
        <div className="mt-10 grid gap-8 sm:grid-cols-2">
          <div className="aspect-[4/3] bg-tint" />
          <div className="aspect-[4/3] bg-tint" />
        </div>
      </div>
    </main>
  );
}
