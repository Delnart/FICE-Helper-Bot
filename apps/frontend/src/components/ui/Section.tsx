import type { ReactNode } from 'react';

/** Titled block: `h2` with an optional right-aligned aside (link, counter, hint). */
export function Section({
  title,
  aside,
  children,
  className,
}: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex flex-col gap-2.5 ${className ?? ''}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="h2">{title}</h2>
        {aside ? <div className="small flex-shrink-0">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}
