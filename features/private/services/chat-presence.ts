/**
 * The bookkeeping behind "who is here" and "who is typing", with no Realtime
 * in it.
 *
 * Split from the socket deliberately. Everything below is timing — when a
 * typing bubble goes stale, how often a pulse may be sent, who counts as
 * present — and timing is exactly the part that breaks in ways a live-socket
 * test cannot reproduce on demand. `use-album-presence.ts` holds the channel
 * and calls into this; this file has no imports and can be tested by moving a
 * number.
 *
 * ## Nothing here is ever persisted
 *
 * Migration 0054 §0 is the long version. The short one: a typing indicator is
 * a keystroke timestamp and an "active 2h ago" label is a permanent activity
 * log, so presence lives on the wire and in memory, and the server writes
 * none of it down. If this file ever grows a `supabase` import, that decision
 * is being reversed — check that it is on purpose.
 */

/** How long a typing pulse keeps the bubble up. Comfortably longer than
 *  PULSE_INTERVAL_MS so an uninterrupted typist never flickers, and short
 *  enough that somebody who closes the app stops "typing" quickly. */
export const TYPING_TTL_MS = 5000;

/** The floor between two outgoing pulses. A keystroke handler fires per
 *  character; this is what stops that becoming a message per character. */
export const PULSE_INTERVAL_MS = 2000;

/** userId → when their most recent pulse arrived. */
export type TypingRegistry = Readonly<Record<string, number>>;

/**
 * Drops everyone whose last pulse is older than the TTL.
 *
 * Returns the SAME object when nothing expired. Callers put this straight into
 * React state, and a fresh object every tick would rerender the chat once a
 * second forever.
 */
export function pruneTyping(
  registry: TypingRegistry,
  now: number,
  ttlMs: number = TYPING_TTL_MS,
): TypingRegistry {
  const live: Record<string, number> = {};
  let dropped = false;
  for (const [userId, at] of Object.entries(registry)) {
    if (now - at < ttlMs) live[userId] = at;
    else dropped = true;
  }
  return dropped ? live : registry;
}

/**
 * Records that `userId` is typing as of `now`.
 *
 * Self is refused rather than filtered by the caller: a pulse echoes back off
 * the channel to its own sender, and "you are typing" rendered at yourself is
 * the kind of bug that survives review because it only shows up with two
 * devices.
 */
export function applyTypingPulse(
  registry: TypingRegistry,
  userId: string,
  now: number,
  selfId: string | null,
): TypingRegistry {
  if (!userId || userId === selfId) return registry;
  return { ...registry, [userId]: now };
}

/** Clears one person immediately — sent when they actually post, so the
 *  bubble does not linger for the rest of the TTL under their own message. */
export function clearTyping(registry: TypingRegistry, userId: string): TypingRegistry {
  if (!(userId in registry)) return registry;
  const next = { ...registry };
  delete next[userId];
  return next;
}

/** Whether an outgoing pulse is due. `lastSentAt` null means none has been
 *  sent for this composing session. */
export function shouldSendPulse(
  lastSentAt: number | null,
  now: number,
  intervalMs: number = PULSE_INTERVAL_MS,
): boolean {
  return lastSentAt === null || now - lastSentAt >= intervalMs;
}

/** The ids currently typing, self excluded, oldest pulse first so the order
 *  does not jitter as pulses land. */
export function typingUserIds(registry: TypingRegistry, selfId: string | null): string[] {
  return Object.entries(registry)
    .filter(([userId]) => userId !== selfId)
    .sort((a, b) => a[1] - b[1])
    .map(([userId]) => userId);
}

/**
 * Flattens Supabase's presence state into the set of other people present.
 *
 * The shape is `{ [presenceKey]: Array<meta> }` — an array because one account
 * can be joined from several devices at once. We only ever ask "is anybody
 * from this account here", so the array collapses to its presence of any
 * entry, and a second device does not make somebody twice as online.
 */
export function onlineUserIds(
  state: Record<string, { userId?: unknown }[]>,
  selfId: string | null,
): string[] {
  const ids = new Set<string>();
  for (const entries of Object.values(state)) {
    for (const entry of entries) {
      const userId = typeof entry?.userId === 'string' ? entry.userId : null;
      if (userId && userId !== selfId) ids.add(userId);
    }
  }
  return [...ids].sort();
}
