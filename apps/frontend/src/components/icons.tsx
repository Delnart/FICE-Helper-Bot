import type { ReactNode } from 'react';

/** Line icons from the «Campus Signal» mockups (24×24, stroke = currentColor). */
const PATHS = {
  home: <path d="M3 11l9-7 9 7v9a2 2 0 0 1-2 2h-4v-6h-6v6H5a2 2 0 0 1-2-2z" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  calendarCheck: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4M9 15l2 2 4-4" />
    </>
  ),
  book: (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </>
  ),
  bookOpen: (
    <>
      <path d="M3 5h6a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H3z" />
      <path d="M21 5h-6a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h7z" />
    </>
  ),
  task: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <path d="M8 12l3 3 5-6" />
    </>
  ),
  checkSquare: (
    <>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4a3.5 3.5 0 0 1 0 7M17 13.5a6.5 6.5 0 0 1 4.5 6.5" />
    </>
  ),
  stack: (
    <>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </>
  ),
  chevronRight: <path d="M9 6l6 6-6 6" />,
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12l5 5L20 7" />,
  list: (
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="4" cy="6" r="1.2" fill="currentColor" />
      <circle cx="4" cy="12" r="1.2" fill="currentColor" />
      <circle cx="4" cy="18" r="1.2" fill="currentColor" />
    </>
  ),
  arrowUpRight: <path d="M7 17L17 7M9 7h8v8" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  chat: <path d="M21 12a8 8 0 0 1-11.6 7.2L4 21l1.8-5.4A8 8 0 1 1 21 12z" />,
  more: (
    <>
      <circle cx="5" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="2" fill="currentColor" stroke="none" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="7" width="13" height="10" rx="2" />
      <path d="M16 10l5-3v10l-5-3" />
    </>
  ),
  star: <path d="M12 3l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.8 6.1 21l1.2-6.5L2.5 9.9 9.1 9z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  send: (
    <>
      <path d="M21 4L3 11l7 2 2 7z" />
      <path d="M10 13l11-9" />
    </>
  ),
  flask: (
    <>
      <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3" />
      <path d="M7.5 15h9" />
    </>
  ),
  bell: (
    <>
      <path d="M6 8a6 6 0 0 1 12 0v5l2 3H4l2-3z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  // Half-filled circle: light / dark appearance.
  theme: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 1.8-2.5 2-2.5 3.5M12 17h.01" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </>
  ),
  swap: (
    <>
      <path d="M7 16V4m0 0L3 8m4-4l4 4" />
      <path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
    </>
  ),
  enter: (
    <>
      <path d="M10 17l5-5-5-5M15 12H3" />
      <path d="M13 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12m0 0l-4-4m4 4l4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.7" />
      <path d="M20 4v5h-5" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  copy: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="3" />
      <path d="M16 8V6a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v7a3 3 0 0 0 3 3h2" />
    </>
  ),
  // Subject glyphs
  cpu: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
      <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  sigma: <path d="M17 5H7l6 7-6 7h10" />,
  code: <path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />,
  graph: (
    <>
      <circle cx="12" cy="5" r="2.5" />
      <circle cx="5" cy="19" r="2.5" />
      <circle cx="19" cy="19" r="2.5" />
      <path d="M10.8 7.2L6.2 16.8M13.2 7.2l4.6 9.6" />
    </>
  ),
  braces: (
    <>
      <path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1" />
      <path d="M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1" />
    </>
  ),
  dice: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" />
      <circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" />
      <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

/* Filled ("active tab") glyphs for the nav icons: solid currentColor shapes, inner details
   knocked out in the tab pill colour so they still read at 22px. */
const KNOCK = { stroke: 'var(--accent-soft)' };
const FILLED: Partial<Record<IconName, ReactNode>> = {
  home: <path d="M3 11l9-7 9 7v9a2 2 0 0 1-2 2h-4v-6h-6v6H5a2 2 0 0 1-2-2z" fill="currentColor" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" fill="currentColor" />
      <path d="M3 10h18" style={KNOCK} />
      <path d="M8 3v4M16 3v4" />
    </>
  ),
  book: (
    <>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" fill="currentColor" />
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" style={KNOCK} />
    </>
  ),
  task: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" fill="currentColor" />
      <path d="M8 12l3 3 5-6" style={KNOCK} strokeWidth={2.2} />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" fill="currentColor" />
      <path d="M4 21a8 8 0 0 1 16 0z" fill="currentColor" />
    </>
  ),
};

export function Icon({
  name,
  size = 20,
  strokeWidth = 2,
  filled,
  className,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  /** Solid variant where one exists (nav icons), else the line icon. */
  filled?: boolean;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {(filled && FILLED[name]) || PATHS[name]}
    </svg>
  );
}

/** Brand mark: the letter F whose middle bar is a lime "signal". */
export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" className={className}>
      <rect width="512" height="512" rx="142" fill="#5B4DFF" />
      <rect x="138" y="144" width="52" height="224" rx="26" fill="#FFFFFF" />
      <rect x="138" y="144" width="236" height="52" rx="26" fill="#FFFFFF" />
      <rect x="206" y="250" width="168" height="52" rx="26" fill="#C9F55B" />
    </svg>
  );
}
