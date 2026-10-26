'use client';

import { useState } from 'react';
import { cn } from '../lib/cn';
import { initials } from '../lib/name';
import { getWebApp } from '../lib/telegram';

/**
 * A person's avatar: their Telegram photo when there is one, otherwise initials.
 * Pass `className` for size/colour variants (e.g. `tile-accent h-9 w-9 text-[12px]`).
 */
export function UserAvatar({ name, src, className }: { name: string; src?: string | null; className?: string }) {
  // Remember which URL failed, so a row that gets a new `src` tries the new photo.
  const [broken, setBroken] = useState<string>();
  const url = src && src !== broken ? src : undefined;
  return (
    <span className={cn('avatar', className)}>
      {url ? (
        // Telegram serves the photo from its own CDN; next/image would need its host whitelisted.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" onError={() => setBroken(url)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}

/** The current user's photo: saved at login (`avatarUrl`), else straight from Telegram's initData. */
export function myAvatarUrl(me?: { avatarUrl?: string } | null): string | undefined {
  return me?.avatarUrl || getWebApp()?.initDataUnsafe?.user?.photo_url || undefined;
}
