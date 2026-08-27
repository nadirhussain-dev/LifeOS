import { formatDistanceToNowStrict } from 'date-fns/formatDistanceToNowStrict';
import { useEffect, useState } from 'react';

/** Live-updating "2h ago" label, refreshed every minute. */
export function useRelativeTime(date: Date) {
  const [label, setLabel] = useState(() => formatDistanceToNowStrict(date, { addSuffix: true }));

  useEffect(() => {
    const id = setInterval(() => {
      setLabel(formatDistanceToNowStrict(date, { addSuffix: true }));
    }, 60_000);
    return () => clearInterval(id);
  }, [date]);

  return label;
}
