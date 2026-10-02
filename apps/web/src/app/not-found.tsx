import Link from "next/link";

/** 404 — "we investigated, nothing lives here". Animations are CSS only and respect reduced-motion. */
export default function NotFound() {
  return (
    <div className="nf grid min-h-[calc(100vh-9rem)] place-items-center px-4">
      <div className="w-full max-w-lg text-center">
        <div className="relative mx-auto h-56 w-72" aria-hidden>
          <div className="nf-glow absolute inset-6 rounded-full bg-accent-soft blur-2xl" />
          {/* the "ticket" being investigated */}
          <div className="nf-card absolute left-1/2 top-1/2 w-56 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-panel p-4 text-left shadow-lg ring-1 ring-line">
            <div className="mb-3 flex items-center gap-2">
              <span className="rounded-md bg-accent-soft px-2 py-0.5 font-mono text-[10px] font-semibold text-accent-strong">TKT-404</span>
              <span className="ml-auto rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-warn ring-1 ring-amber-200">investigating</span>
            </div>
            <div className="space-y-2">
              <div className="nf-line h-2 w-11/12 rounded bg-line" />
              <div className="nf-line h-2 w-8/12 rounded bg-line" style={{ animationDelay: ".2s" }} />
              <div className="nf-line h-2 w-10/12 rounded bg-line" style={{ animationDelay: ".4s" }} />
              <div className="nf-line h-2 w-6/12 rounded bg-line" style={{ animationDelay: ".6s" }} />
            </div>
          </div>
          {/* magnifying glass sweeping over it */}
          <svg className="nf-lens absolute left-1/2 top-1/2 h-20 w-20 text-accent-strong drop-shadow" viewBox="0 0 64 64" fill="none">
            <circle cx="26" cy="26" r="17" fill="white" fillOpacity=".55" stroke="currentColor" strokeWidth="5" />
            <path d="m39 39 15 15" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
            <path d="M18 21a10 10 0 0 1 7-6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".5" />
          </svg>
        </div>

        <div className="nf-num mt-4 bg-gradient-to-br from-[#0f5132] via-[#15803d] to-[#22a35a] bg-clip-text text-7xl font-bold tracking-tight text-transparent">404</div>
        <h1 className="mt-2 text-xl font-semibold">We investigated — nothing lives here</h1>
        <p className="mt-2 text-sm text-muted">Logs, database and code all came back empty for this address. It may have moved, or the link has a typo.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href="/tickets" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-strong">Back to tickets</Link>
          <Link href="/knowledge" className="rounded-lg border border-line bg-panel px-4 py-2 text-sm font-medium hover:border-accent">Knowledge</Link>
        </div>
      </div>
    </div>
  );
}
