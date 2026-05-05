export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card flex flex-col items-center text-center py-10">
      <div className="h-12 w-12 rounded-full bg-paper-200 flex items-center justify-center mb-3">
        <svg viewBox="0 0 24 24" className="h-6 w-6 text-ink-500" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M5 7h14M5 12h14M5 17h8" strokeLinecap="round" />
        </svg>
      </div>
      <div className="font-semibold">{title}</div>
      {hint ? <div className="text-sm text-ink-500 mt-1">{hint}</div> : null}
    </div>
  );
}
