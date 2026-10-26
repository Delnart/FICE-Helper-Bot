import type { ReactNode } from 'react';
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
      <span className="tile tile-soft mb-1">
        <Icon name={icon} size={22} strokeWidth={1.9} />
      </span>
      <div className="h3">{title}</div>
      {hint ? <div className="small muted max-w-xs">{hint}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Inline loading placeholder used while a query is pending. */
export function Loading({ label = 'Завантаження…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-ink-3" role="status">
      <div className="spinner" />
      <div className="small">{label}</div>
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
      <span className="tile mb-1 bg-bad-soft text-bad">
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
