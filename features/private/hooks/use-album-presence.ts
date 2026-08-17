import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';

import {
  applyTypingPulse,
  clearTyping,
  onlineUserIds,
  pruneTyping,
  shouldSendPulse,
  typingUserIds,
  TYPING_TTL_MS,
  type TypingRegistry,
} from '@/features/private/services/chat-presence';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { usePrivateStore } from '@/features/private/store/private-store';
import { supabase } from '@/lib/supabase';

/**
 * "Who is in this chat right now" and "who is typing", over Realtime.
 *
 * A channel of its own rather than an extra listener on `useAlbumRealtime`'s.
 * That one exists to invalidate queries when rows change and is mounted
 * wherever an album is on screen; this one carries `track()` state, and
 * tracking presence from a screen that merely *lists* albums would announce
 * you as present in every album you belong to at once.
 *
 * Typing rides broadcast, not presence, because the two have different
 * lifetimes: presence is a state that persists until you leave, typing is a
 * pulse that must expire on its own even if the sender vanishes mid-word. A
 * presence field would leave the last typist typing forever after a crash.
 *
 * Gated on the private space being unlocked and real, the same condition
 * `useAlbumRealtime` uses — a decoy unlock must not announce anybody anywhere.
 */
export function useAlbumPresence(albumId: string | undefined): {
  onlineIds: string[];
  typingIds: string[];
  /** Call on every keystroke. Throttled internally — see PULSE_INTERVAL_MS. */
  notifyTyping: () => void;
  /** Call when the message actually goes, to drop your own bubble at once. */
  notifySent: () => void;
} {
  const selfId = useAuthStore((s) => s.session?.user.id ?? null);
  const space = usePrivateStore((s) => s.space);
  const vaultKeyValue = usePrivateStore((s) => s.key);
  const instanceId = useId();

  const [typing, setTyping] = useState<TypingRegistry>({});
  const [onlineIds, setOnlineIds] = useState<string[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastPulseRef = useRef<number | null>(null);

  const active = Boolean(albumId) && Boolean(vaultKeyValue) && space === 'real' && Boolean(selfId);

  useEffect(() => {
    if (!active || !albumId || !selfId) return;

    const channel = supabase.channel(`album-presence:${albumId}:${instanceId}`, {
      config: {
        // Keyed by account, so two devices on one account collapse to one
        // presence rather than showing the same person twice.
        presence: { key: selfId },
        // Our own pulse coming back would otherwise render "you are typing"
        // at yourself. `applyTypingPulse` refuses self as well — belt and
        // braces, because this flag is a server-side default we do not own.
        broadcast: { self: false },
      },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        setOnlineIds(
          onlineUserIds(channel.presenceState() as Record<string, { userId?: unknown }[]>, selfId),
        );
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const userId = typeof payload?.userId === 'string' ? payload.userId : null;
        if (userId) setTyping((prev) => applyTypingPulse(prev, userId, Date.now(), selfId));
      })
      .on('broadcast', { event: 'sent' }, ({ payload }) => {
        const userId = typeof payload?.userId === 'string' ? payload.userId : null;
        if (userId) setTyping((prev) => clearTyping(prev, userId));
      });

    void channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') void channel.track({ userId: selfId, at: Date.now() });
    });

    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      lastPulseRef.current = null;
      setTyping({});
      setOnlineIds([]);
      void supabase.removeChannel(channel);
    };
  }, [active, albumId, selfId, instanceId]);

  // Expiry is driven here rather than by each pulse's own timer: one interval
  // for the screen, instead of a timer per typist that has to be cancelled
  // when they pulse again. `pruneTyping` returns the same object when nothing
  // expired, so this is free on the overwhelming majority of ticks.
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setTyping((prev) => pruneTyping(prev, Date.now()));
    }, 1000);
    return () => clearInterval(timer);
  }, [active]);

  const notifyTyping = useCallback(() => {
    const channel = channelRef.current;
    if (!channel || !selfId) return;
    const now = Date.now();
    if (!shouldSendPulse(lastPulseRef.current, now)) return;
    lastPulseRef.current = now;
    void channel.send({ type: 'broadcast', event: 'typing', payload: { userId: selfId } });
  }, [selfId]);

  const notifySent = useCallback(() => {
    const channel = channelRef.current;
    if (!channel || !selfId) return;
    // Reset the throttle too: the next message's first keystroke should pulse
    // immediately rather than waiting out the interval from the last one.
    lastPulseRef.current = null;
    void channel.send({ type: 'broadcast', event: 'sent', payload: { userId: selfId } });
  }, [selfId]);

  const typingIds = useMemo(() => typingUserIds(typing, selfId), [typing, selfId]);

  return { onlineIds, typingIds, notifyTyping, notifySent };
}

export { TYPING_TTL_MS };
