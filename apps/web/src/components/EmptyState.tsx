/** "Nothing here" with the 404 page's magnifying-glass animation (same .nf CSS), scaled down for tables. */
export function EmptyState({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="nf grid place-items-center px-4 py-10">
      <div className="w-full max-w-md text-center">
        <div className="relative mx-auto h-40 w-56" aria-hidden>
          <div className="nf-glow absolute inset-4 rounded-full bg-accent-soft blur-2xl" />
          <div className="nf-card absolute left-1/2 top-1/2 w-44 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-panel p-3 text-left shadow-lg ring-1 ring-line">
            <div className="mb-2.5 flex items-center gap-2">
              <span className="rounded-md bg-accent-soft px-1.5 py-0.5 font-mono text-[9px] font-semibold text-accent-strong">TKT-0</span>
              <span className="ml-auto rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] text-warn ring-1 ring-amber-200">searching</span>
            </div>
            <div className="space-y-1.5">
              <div className="nf-line h-1.5 w-11/12 rounded bg-line" />
              <div className="nf-line h-1.5 w-8/12 rounded bg-line" style={{ animationDelay: ".2s" }} />
              <div className="nf-line h-1.5 w-10/12 rounded bg-line" style={{ animationDelay: ".4s" }} />
            </div>
          </div>
          <svg className="nf-lens absolute left-1/2 top-1/2 h-16 w-16 text-accent-strong drop-shadow" viewBox="0 0 64 64" fill="none">
            <circle cx="26" cy="26" r="17" fill="white" fillOpacity=".55" stroke="currentColor" strokeWidth="5" />
            <path d="m39 39 15 15" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
            <path d="M18 21a10 10 0 0 1 7-6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".5" />
          </svg>
        </div>
        <h3 className="mt-3 text-base font-semibold text-fg">{title}</h3>
        {text && <p className="mt-1 text-sm text-muted">{text}</p>}
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}
