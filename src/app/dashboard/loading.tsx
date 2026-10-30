export default function DashboardLoading() {
  return (
    <main role="status" aria-busy="true" className="shell-wrap py-10 lg:py-16">
      <span className="sr-only">Loading your studio…</span>
      <div aria-hidden="true" className="motion-safe:animate-pulse">
        <div className="h-14 w-2/3 max-w-sm bg-tint" />
        <div className="mt-5 h-5 w-3/4 max-w-md bg-tint" />
        <div className="mt-8 h-24 border-y border-line bg-tint" />
        <div className="mt-10 grid gap-10 lg:grid-cols-[1.5fr_1fr]">
          <div className="h-56 border border-line bg-tint" />
          <div className="h-56 border border-line bg-tint" />
        </div>
      </div>
    </main>
  );
}
