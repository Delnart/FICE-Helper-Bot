import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Icon, type IconName } from './icons';

export function Empty({
  title,
  hint,
  icon = 'list',
  action,
}: {
  title: string;
  hint?: ReactNode;
  icon?: IconName;
  action?: ReactNode;
}) {
  return (
    <div className="card-flat flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span className="tile tile-soft anim-pop mb-1" style={{ animationDelay: '80ms' }}>
        <Icon name={icon} size={22} strokeWidth={1.9} />
      </span>
      <div className="h3">{title}</div>
      {hint ? <div className="small muted max-w-xs">{hint}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** What is about to load: list rows, wider cards, the Дисципліни grid, schedule lessons. */
type LoadingShape = 'rows' | 'cards' | 'grid' | 'lessons';

// Line widths per item, so a skeleton doesn't read as a table of identical bars.
const SK_WIDTHS = ['w-3/5', 'w-4/5', 'w-1/2', 'w-2/3'];

/**
 * Loading placeholder while a query is pending: a skeleton in the `shape` of what is coming, so the
 * content lands where the placeholder was. With a `label` it is the spinner and that text (waits
 * that are worth naming: authorising, connecting to Кампус).
 */
export function Loading({
  label,
  shape = 'rows',
  count = shape === 'grid' ? 4 : 3,
}: {
  label?: string;
  shape?: LoadingShape;
  count?: number;
}) {
  if (label) {
    return (
      // Fades in after a beat: a fast answer never flashes the spinner.
      <div
        className="anim-fade flex flex-col items-center justify-center gap-3 py-16 text-ink-3"
        style={{ animationDelay: '120ms' }}
        role="status"
      >
        <div className="spinner" />
        <div className="small">{label}</div>
      </div>
    );
  }
  return (
    <div
      // Rows space themselves (.row + .row).
      className={cn(
        'anim-fade',
        shape === 'grid' ? 'grid grid-cols-2 gap-2.5' : shape === 'rows' ? 'flex flex-col' : 'flex flex-col gap-2.5',
      )}
      role="status"
      aria-label="Завантаження…"
    >
      {Array.from({ length: count }, (_, i) => {
        const w = SK_WIDTHS[i % SK_WIDTHS.length];
        const d = { '--d': i } as CSSProperties;
        if (shape === 'grid')
          return (
            <div key={i} className="card-flat sk flex min-h-[150px] flex-col gap-3 p-3.5" style={d}>
              <span className="sk-b h-11 w-11 rounded-[14px]" />
              <span className="flex flex-1 flex-col gap-2">
                <span className={cn('sk-b h-3.5', w)} />
                <span className="sk-b h-3 w-2/5" />
              </span>
              <span className="sk-b h-6 w-20 rounded-full" />
            </div>
          );
        const card = (
          <div key={i} className="card-flat sk flex min-w-0 flex-1 flex-col gap-2.5 p-3.5" style={d}>
            <span className="sk-b h-6 w-20 rounded-full" />
            <span className={cn('sk-b h-4', w)} />
            <span className="sk-b h-3 w-2/5" />
          </div>
        );
        if (shape === 'cards') return card;
        if (shape === 'lessons')
          return (
            <div key={i} className="flex gap-3">
              <span className="flex w-[50px] flex-shrink-0 flex-col gap-1.5 pt-4">
                <span className="sk-b h-3.5 w-10" />
                <span className="sk-b h-3 w-8" />
              </span>
              {card}
            </div>
          );
        return (
          <div key={i} className="row sk" style={d}>
            <span className="sk-b h-10 w-10 rounded-[12px]" />
            <span className="flex min-w-0 flex-1 flex-col gap-2">
              <span className={cn('sk-b h-3.5', w)} />
              <span className="sk-b h-3 w-2/5" />
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Failed query: shows the server message (403/409 texts are user-facing) and a retry button.
 * Never fall through to <Empty> on error — "no data" and "failed to load" must look different.
 */
export function ErrorState({
  error,
  onRetry,
  title = 'Не вдалося завантажити',
}: {
  error?: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const message = error instanceof Error ? error.message : null;
  return (
    <div className="card-flat flex flex-col items-center gap-2 px-6 py-8 text-center" role="alert">
      <span className="tile anim-pop mb-1 bg-bad-soft text-bad" style={{ animationDelay: '80ms' }}>
        <Icon name="info" size={22} strokeWidth={1.9} />
      </span>
      <div className="h3">{title}</div>
      {message ? <div className="small muted max-w-xs break-words">{message}</div> : null}
      {onRetry ? (
        <button type="button" className="btn btn-secondary btn-md mt-2" onClick={onRetry}>
          <Icon name="refresh" size={18} />
          Спробувати ще раз
        </button>
      ) : null}
    </div>
  );
}
