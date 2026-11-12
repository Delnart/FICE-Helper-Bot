'use client';

import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import 'dayjs/locale/uk';
import { PageHeader } from '../../../components/PageHeader';
import { Empty, ErrorState, Loading } from '../../../components/Empty';
import { markNoticesSeen, noticesSeenUpTo, useNotices } from '../../../hooks/useNotices';

export default function NotificationsPage() {
  const { data, isError, error, refetch } = useNotices();
  // Opening the page marks everything seen, so what was new is told by the mark as it stood on arrival.
  const [seenOnArrival] = useState(noticesSeenUpTo);
  useEffect(() => {
    if (data?.length) markNoticesSeen(data[0].createdAt);
  }, [data]);

  return (
    <div className="stagger flex flex-col gap-4">
      <PageHeader title="Сповіщення" subtitle="Повідомлення від розробника" />
      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} title="Не вдалося завантажити сповіщення" />
      ) : !data ? (
        <Loading shape="cards" />
      ) : !data.length ? (
        <Empty title="Поки що тихо" icon="bell" hint="Тут зʼявлятимуться новини застосунку й бота." />
      ) : (
        <div className="stagger flex flex-col gap-2.5">
          {data.map((n) => (
            <article key={n._id} className="card-flat flex flex-col gap-1.5">
              <div className="flex items-start justify-between gap-3">
                <h2 className="h3 min-w-0 break-words">{n.title}</h2>
                {n.createdAt > seenOnArrival ? <span className="chip chip-accent flex-shrink-0">нове</span> : null}
              </div>
              {n.body ? <p className="small muted whitespace-pre-line break-words">{n.body}</p> : null}
              <time className="tiny faint" dateTime={n.createdAt}>
                {dayjs(n.createdAt).locale('uk').format('D MMMM, HH:mm')}
              </time>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
