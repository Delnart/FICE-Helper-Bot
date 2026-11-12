'use client';

import { usePathname } from 'next/navigation';
import { Sheet } from './ui/Sheet';
import { markNoticesSeen, useNotices } from '../hooks/useNotices';
import { haptic } from '../lib/telegram';

/**
 * The developer's newest message the reader has not seen, as a sheet over the screen the app opened on.
 * Closing it any way marks it, and the older ones, as seen; they all stay under «Сповіщення».
 */
export function NoticePopup() {
  const pathname = usePathname();
  const { unread } = useNotices();
  // On the list itself the message is already in front of the reader.
  const notice = pathname === '/notifications' ? undefined : unread[0];
  const seen = () => {
    if (notice) markNoticesSeen(notice.createdAt);
  };

  return (
    <Sheet open={!!notice} onClose={seen} title={notice?.title ?? ''}>
      {notice?.body ? <p className="whitespace-pre-line break-words leading-normal text-ink-2">{notice.body}</p> : null}
      <button
        type="button"
        className="btn btn-primary btn-block"
        onClick={() => {
          haptic('light');
          seen();
        }}
      >
        Зрозуміло
      </button>
    </Sheet>
  );
}
