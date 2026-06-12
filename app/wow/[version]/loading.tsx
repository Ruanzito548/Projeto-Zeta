export default function LoadingWowVersion() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_0%_0%,rgba(16,185,129,0.15),transparent_34%),radial-gradient(circle_at_90%_10%,rgba(14,116,144,0.2),transparent_36%),linear-gradient(180deg,#020407_0%,#030a0f_45%,#02050a_100%)] px-4 py-8 text-slate-100 md:px-8 md:py-10">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-7">
        <div className="h-40 animate-pulse rounded-3xl border border-emerald-500/25 bg-[linear-gradient(145deg,rgba(7,18,20,0.9),rgba(4,11,18,0.95))]" />
        <div className="h-[540px] animate-pulse rounded-3xl border border-emerald-500/20 bg-[linear-gradient(160deg,rgba(6,11,14,0.94),rgba(7,13,22,0.94)_55%,rgba(3,8,12,0.96))]" />
      </div>
    </main>
  );
}
