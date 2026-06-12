export default function LoadingWowVersion() {
  return (
    <main className="min-h-screen bg-black px-4 py-8 text-green-100 md:px-8 md:py-10">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-7">
        <div className="h-40 animate-pulse rounded-3xl border border-green-500/25 bg-[linear-gradient(145deg,rgba(0,10,4,0.98),rgba(0,6,2,0.99))]" />
        <div className="h-[540px] animate-pulse rounded-3xl border border-green-500/20 bg-[linear-gradient(160deg,rgba(0,8,3,0.97),rgba(0,5,2,0.98))]" />
      </div>
    </main>
  );
}
