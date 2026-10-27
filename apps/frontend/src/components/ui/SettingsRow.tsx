import Link from 'next/link';
import type { Route } from 'next';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons';

/** Icon tile + title + hint row for `.card-flat` lists: a link (`href`), a button (`onClick`) or static. */
export function SettingsRow({
  href,
  onClick,
  icon,
  title,
  hint,
}: {
  href?: Route;
  onClick?: () => void;
  icon: IconName;
  title: string;
  hint: ReactNode;
}) {
  const body = (
    <div className="flex min-w-0 items-center gap-3">
      <span className="tile tile-soft h-9 w-9 rounded-[10px]">
        <Icon name={icon} size={18} />
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="h3">{title}</span>
        <span className="tiny faint truncate">{hint}</span>
      </div>
    </div>
  );
  if (onClick)
    return (
      <button type="button" className="row-plain w-full justify-between text-left" onClick={onClick}>
        {body}
        <Icon name="chevronRight" className="chev" />
      </button>
    );
  if (!href) return <div className="row-plain">{body}</div>;
  return (
    <Link href={href} className="row-plain justify-between">
      {body}
      <Icon name="chevronRight" className="chev" />
    </Link>
  );
}
