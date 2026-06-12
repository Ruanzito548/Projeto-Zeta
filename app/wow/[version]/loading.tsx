export default function LoadingWowVersion() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#14100a_0%,#0d1425_45%,#04070d_100%)] px-3 py-5 text-slate-100 md:px-6 md:py-7">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <div className="h-24 animate-pulse rounded-xl border border-amber-500/20 bg-slate-900/65" />
        <div className="h-72 animate-pulse rounded-xl border border-amber-500/20 bg-slate-900/65" />
      </div>
    </main>
  );
}
