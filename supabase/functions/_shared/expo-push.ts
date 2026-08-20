// Sending to Expo's push service, and finding out what happened.
//
// Both notify functions had their own copy of a fan-out that counted an HTTP
// 200 as "delivered". It is not. Expo answers a send with one **ticket** per
// message, and a ticket can carry `status: 'error'` inside a 200 response —
// most importantly `DeviceNotRegistered`, which means the app was uninstalled
// or the token was rotated and this token will never work again.
//
// Nothing read those tickets, so nothing ever learned that a token was dead.
// `push_tokens` therefore only grew: every uninstall left a row behind, every
// fan-out paid to send to it, and the "sent" number the functions returned
// counted those sends as successes. A group of four where three people have
// reinstalled reports `sent: 4`.
//
// This module reads the tickets, reports which tokens to delete, and hands back
// the ticket ids so delivery can be confirmed later — see `check-push-receipts`,
// which is the other half: a ticket only says Expo accepted the message, and
// the receipt fetched afterwards is what says APNs/FCM actually took it.
//
// Deliberately free of `Deno` at module scope so the app's jest suite can test
// it: `fetch` and the access token are injected rather than read from the
// environment here. The functions that use it read `Deno.env` and pass it in.

/** Expo rejects batches larger than this. */
export const CHUNK = 100;

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export type ExpoPushContent = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /**
   * Android channel to land on. Without one a push falls to app.json's
   * `defaultChannel`, which is how every remote notification — a shared album
   * message and an expense-group update alike — ended up sharing a single
   * channel the user could only silence as a whole.
   */
  channelId?: string;
  /**
   * Collapse key. Two messages sharing one replace each other on the device
   * rather than stacking, which is the server-side counterpart to the local
   * scheduler's dedupe key: four sends about the same thing become one
   * notification instead of four.
   */
  collapseId?: string;
  /** 'high' wakes the device; 'normal' may be batched by the OS. */
  priority?: 'default' | 'normal' | 'high';
  /** Seconds Expo may keep trying. A nudge about tonight is worthless
   *  tomorrow, so callers about time-bound things should set this. */
  ttl?: number;
  sound?: 'default' | null;
};

export type PushOutcome = {
  /** Messages Expo accepted — a ticket, not yet a delivery. */
  accepted: number;
  /** Messages Expo rejected outright. */
  rejected: number;
  /** Tokens that will never work again. Delete them. */
  deadTokens: string[];
  /**
   * Accepted messages, each paired with the device it went to.
   *
   * Paired, not a bare list of ids, because a receipt's whole value is being
   * able to delete the token behind a fatal one — an id with nothing attached
   * tells you a message failed and not who to stop sending to.
   */
  tickets: { id: string; token: string }[];
};

type Ticket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message?: string; details?: { error?: string } };

export type PushDeps = {
  fetch: typeof globalThis.fetch;
  /** Expo access token, when push security is enabled. */
  accessToken?: string;
};

/**
 * Errors that mean "this token is permanently dead".
 *
 * Deliberately not `MessageRateExceeded` or `MessageTooBig`: those are about
 * this *send*, not this token, and deleting a token because one message was too
 * large would silently unsubscribe somebody from every future notification over
 * a bug in one line of copy.
 */
const FATAL_TOKEN_ERRORS = new Set(['DeviceNotRegistered', 'InvalidCredentials']);

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Sends one message to many tokens and reports what Expo said about each.
 *
 * Never throws: a bounced push must not make the caller think the write it
 * accompanies failed. A batch that errors at the transport level is counted as
 * rejected, and its tokens are left alone — a network blip is not evidence that
 * a device is gone.
 */
export async function sendExpoPush(
  tokens: string[],
  content: ExpoPushContent,
  deps: PushDeps,
): Promise<PushOutcome> {
  const outcome: PushOutcome = { accepted: 0, rejected: 0, deadTokens: [], tickets: [] };
  if (tokens.length === 0) return outcome;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (deps.accessToken) headers.Authorization = `Bearer ${deps.accessToken}`;

  for (const batch of chunk(tokens, CHUNK)) {
    const messages = batch.map((to) => ({
      to,
      title: content.title,
      body: content.body,
      sound: content.sound === null ? undefined : (content.sound ?? 'default'),
      data: content.data ?? {},
      ...(content.channelId ? { channelId: content.channelId } : {}),
      ...(content.collapseId ? { collapseId: content.collapseId } : {}),
      ...(content.priority ? { priority: content.priority } : {}),
      ...(content.ttl !== undefined ? { ttl: content.ttl } : {}),
    }));

    let tickets: Ticket[] | null = null;
    try {
      const res = await deps.fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(messages),
      });
      if (res.ok) {
        const parsed = (await res.json()) as { data?: Ticket[] };
        tickets = Array.isArray(parsed?.data) ? parsed.data : null;
      }
    } catch {
      // Transport failure. Falls through to the null-tickets branch below.
    }

    if (!tickets) {
      // Expo never answered, or answered something unreadable. Every message in
      // the batch is a failure and no token is blamed for it.
      outcome.rejected += batch.length;
      continue;
    }

    tickets.forEach((ticket, index) => {
      if (ticket.status === 'ok') {
        outcome.accepted += 1;
        // `batch[index]` is safe because Expo returns tickets positionally.
        if (ticket.id) outcome.tickets.push({ id: ticket.id, token: batch[index] });
        return;
      }
      outcome.rejected += 1;
      const reason = ticket.details?.error;
      if (reason && FATAL_TOKEN_ERRORS.has(reason)) outcome.deadTokens.push(batch[index]);
    });

    // A short array is Expo disagreeing with us about how many messages we
    // sent. Count the difference rather than silently reporting fewer.
    if (tickets.length < batch.length) outcome.rejected += batch.length - tickets.length;
  }

  return outcome;
}

const EXPO_RECEIPT_URL = 'https://exp.host/--/api/v2/push/getReceipts';

/** Expo accepts at most this many ticket ids per receipt lookup. */
export const RECEIPT_CHUNK = 300;

export type ReceiptVerdict = {
  /** Tickets that came back delivered. Their rows can be dropped. */
  delivered: string[];
  /** Tickets whose receipt says the token is dead, mapped to the ticket id so
   *  the caller can resolve it back to a token and delete both. */
  fatal: string[];
  /** Tickets that failed for a reason that is not the token's fault — worth
   *  forgetting, not worth unsubscribing anybody over. */
  failed: string[];
  /** Receipts Expo does not have an answer for yet. Leave them and re-check. */
  pending: string[];
};

type Receipt = { status: 'ok' } | { status: 'error'; details?: { error?: string } };

/**
 * Looks up receipts for tickets already sent.
 *
 * The half a ticket cannot tell you: a ticket says Expo accepted the message,
 * a receipt says APNs or FCM did. `DeviceNotRegistered` arriving here rather
 * than at send time is the common case for a device that was uninstalled after
 * its last successful push, which is most of them.
 *
 * A ticket id Expo has no answer for is reported `pending` rather than assumed
 * good — the difference matters, because treating "not ready" as "delivered"
 * would throw away the row before the verdict that deletes a dead token.
 */
export async function fetchExpoReceipts(
  ticketIds: string[],
  deps: PushDeps,
): Promise<ReceiptVerdict> {
  const verdict: ReceiptVerdict = { delivered: [], fatal: [], failed: [], pending: [] };
  if (ticketIds.length === 0) return verdict;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (deps.accessToken) headers.Authorization = `Bearer ${deps.accessToken}`;

  for (const batch of chunk(ticketIds, RECEIPT_CHUNK)) {
    let receipts: Record<string, Receipt> | null = null;
    try {
      const res = await deps.fetch(EXPO_RECEIPT_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ids: batch }),
      });
      if (res.ok) {
        const parsed = (await res.json()) as { data?: Record<string, Receipt> };
        receipts = parsed?.data ?? null;
      }
    } catch {
      // Transport failure — every id in this batch stays pending below.
    }

    for (const id of batch) {
      const receipt = receipts?.[id];
      if (!receipt) {
        verdict.pending.push(id);
        continue;
      }
      if (receipt.status === 'ok') {
        verdict.delivered.push(id);
        continue;
      }
      const reason = receipt.details?.error;
      if (reason && FATAL_TOKEN_ERRORS.has(reason)) verdict.fatal.push(id);
      else verdict.failed.push(id);
    }
  }

  return verdict;
}

/** Minimal shape of the service-role client this needs. */
type AdminClient = {
  from: (table: string) => {
    delete: () => { in: (column: string, values: string[]) => Promise<{ error: unknown }> };
    insert: (rows: Record<string, unknown>[]) => Promise<{ error: unknown }>;
  };
};

/**
 * Writes down which tickets are owed a receipt.
 *
 * Separate from the send because the send must stay pure enough to test without
 * a database, and separate from the receipt check because Expo's receipts are
 * not ready when the send returns — waiting for them would hold an edge
 * function open for minutes, on the request path of a user action, to learn
 * something nobody is waiting for. See migration 0068.
 *
 * `deadTokens` are excluded implicitly: a rejected message never got a ticket.
 * Best-effort — losing a ticket costs a receipt, not a notification.
 */
export async function recordTickets(
  admin: AdminClient,
  outcome: Pick<PushOutcome, 'tickets'>,
  now: number,
): Promise<number> {
  if (outcome.tickets.length === 0) return 0;
  try {
    await admin.from('push_receipts').insert(
      outcome.tickets.map((ticket) => ({
        ticket_id: ticket.id,
        token: ticket.token,
        created_at: now,
        checked_at: null,
      })),
    );
    return outcome.tickets.length;
  } catch {
    return 0;
  }
}

/**
 * Removes tokens Expo has told us are dead.
 *
 * Best-effort and never throws, for the same reason the send is: this runs
 * after a write that already succeeded, and a failed cleanup is a row to sweep
 * up later, not a reason to fail the caller's request.
 */
export async function pruneDeadTokens(admin: AdminClient, tokens: string[]): Promise<number> {
  if (tokens.length === 0) return 0;
  try {
    await admin.from('push_tokens').delete().in('token', tokens);
    return tokens.length;
  } catch {
    return 0;
  }
}
