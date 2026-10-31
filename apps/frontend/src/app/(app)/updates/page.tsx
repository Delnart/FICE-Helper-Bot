'use client';

import { useState } from 'react';
import dayjs from 'dayjs';
import 'dayjs/locale/uk';
import { PageHeader } from '../../../components/PageHeader';
import { Icon } from '../../../components/icons';
import { cn } from '../../../lib/cn';
import { haptic } from '../../../lib/telegram';

interface Release {
  version: string;
  date?: string;
  sections: Array<{ title?: string; paragraphs: string[]; items: string[] }>;
}

// Inlined at build time (next.config.js): the releases come from the root CHANGELOG.md.
const RELEASES: Release[] = JSON.parse(process.env.NEXT_PUBLIC_CHANGELOG ?? '[]');
const CURRENT = process.env.NEXT_PUBLIC_APP_VERSION;

/** "2026-10-31" → "31 жовтня 2026"; a period like «травень–вересень 2026» stays as written. */
function dateLabel(date = ''): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? dayjs(date).locale('uk').format('D MMMM YYYY') : date;
}

export default function UpdatesPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Оновлення" subtitle="Що нового в застосунку й боті" />
      <div className="flex flex-col gap-2.5">
        {RELEASES.map((release, i) => (
          <ReleaseCard key={release.version} release={release} defaultOpen={i === 0} />
        ))}
      </div>
    </div>
  );
}

function ReleaseCard({ release, defaultOpen }: { release: Release; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="card-flat p-0">
      <button
        type="button"
        aria-expanded={open}
        className="flex min-h-[52px] w-full items-center gap-2 px-4 py-3 text-left"
        onClick={() => {
          haptic('light');
          setOpen((v) => !v);
        }}
      >
        <span className="h3">v{release.version}</span>
        {release.version === CURRENT ? <span className="chip chip-accent">поточна</span> : null}
        <span className="tiny faint ml-auto text-right">{dateLabel(release.date)}</span>
        <Icon
          name="chevronDown"
          size={18}
          className={cn('chev transition-transform duration-200', open && 'rotate-180')}
        />
      </button>
      <div className={cn('fold', open && 'open')}>
        <div>
          <div className="flex flex-col gap-3 px-4 pb-4">
            {release.sections.map((s, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                {s.title ? <h3 className="eyebrow">{s.title}</h3> : null}
                {s.paragraphs.map((p) => (
                  <p key={p} className="small muted">
                    {p}
                  </p>
                ))}
                {s.items.length ? (
                  <ul className="small muted flex list-disc flex-col gap-1.5 pl-5 marker:text-ink-3">
                    {s.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
