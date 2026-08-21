import {
  CHUNK,
  fetchExpoReceipts,
  pruneDeadTokens,
  recordTickets,
  sendExpoPush,
  type PushDeps,
} from './expo-push';

/**
 * What Expo actually tells you, and what the old code heard instead.
 *
 * Both notify functions counted an HTTP 200 as delivery. Expo returns a 200
 * carrying a per-message ticket that may itself say `error`, so the number
 * those functions reported as `sent` included every message to a device that
 * had been uninstalled — and because nothing read the ticket, the dead token
 * stayed in `push_tokens` and was paid for again on the next fan-out.
 *
 * These are the cases that distinguish "Expo took it" from "somebody got it",
 * and the ones where the difference costs a real user their notifications.
 */

/** A fetch that answers with `body` and records what it was asked. */
function stubFetch(bodies: unknown[] | unknown, ok = true) {
  const queue = Array.isArray(bodies) ? [...bodies] : [bodies];
  const calls: { url: string; body: unknown; headers: Record<string, string> }[] = [];
  const fn = jest.fn(async (url: unknown, init: unknown) => {
    const request = init as { body: string; headers: Record<string, string> };
    calls.push({
      url: String(url),
      body: JSON.parse(request.body),
      headers: request.headers,
    });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return {
      ok,
      json: async () => next,
    } as unknown as Response;
  });
  return { fn: fn as unknown as PushDeps['fetch'], calls };
}

const content = { title: 'Title', body: 'Body' };

describe('sendExpoPush', () => {
  it('reports an accepted message as a ticket, not a delivery', async () => {
    const { fn } = stubFetch({ data: [{ status: 'ok', id: 'ticket-1' }] });

    const outcome = await sendExpoPush(['tok-1'], content, { fetch: fn });

    expect(outcome.accepted).toBe(1);
    expect(outcome.tickets).toEqual([{ id: 'ticket-1', token: 'tok-1' }]);
    // The whole point: nothing here claims delivery, and the ticket is kept so
    // the receipt can be looked up later.
    expect(outcome.deadTokens).toEqual([]);
  });

  it('names the dead token inside a 200 response', async () => {
    // The bug in one test. HTTP 200, and the second device is gone.
    const { fn } = stubFetch({
      data: [
        { status: 'ok', id: 'ticket-1' },
        { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } },
      ],
    });

    const outcome = await sendExpoPush(['tok-1', 'tok-2'], content, { fetch: fn });

    expect(outcome.accepted).toBe(1);
    expect(outcome.rejected).toBe(1);
    expect(outcome.deadTokens).toEqual(['tok-2']);
  });

  it('does not blame the token for an error about the message', async () => {
    const { fn } = stubFetch({
      data: [{ status: 'error', details: { error: 'MessageTooBig' } }],
    });

    const outcome = await sendExpoPush(['tok-1'], content, { fetch: fn });

    expect(outcome.rejected).toBe(1);
    // Deleting a token over one oversized message would silently unsubscribe
    // somebody from everything, forever, because of a bug in one line of copy.
    expect(outcome.deadTokens).toEqual([]);
  });

  it('blames nobody when the request itself fails', async () => {
    const failing = jest.fn(async () => {
      throw new Error('network down');
    }) as unknown as PushDeps['fetch'];

    const outcome = await sendExpoPush(['tok-1', 'tok-2'], content, { fetch: failing });

    expect(outcome.rejected).toBe(2);
    expect(outcome.deadTokens).toEqual([]);
    expect(outcome.tickets).toEqual([]);
  });

  it('never throws, so a bounced push cannot fail the write it followed', async () => {
    const garbage = stubFetch('not json at all', false);
    await expect(sendExpoPush(['tok-1'], content, { fetch: garbage.fn })).resolves.toMatchObject({
      rejected: 1,
    });
  });

  it('batches beyond Expo’s limit and keeps tokens aligned with tickets', async () => {
    const tokens = Array.from({ length: CHUNK + 2 }, (_, i) => `tok-${i}`);
    // First batch all fine; second batch has one dead device.
    const { fn, calls } = stubFetch([
      { data: tokens.slice(0, CHUNK).map((_, i) => ({ status: 'ok', id: `t-${i}` })) },
      {
        data: [
          { status: 'ok', id: 't-100' },
          { status: 'error', details: { error: 'DeviceNotRegistered' } },
        ],
      },
    ]);

    const outcome = await sendExpoPush(tokens, content, { fetch: fn });

    expect(calls).toHaveLength(2);
    // The alignment that makes the dead-token report trustworthy: Expo answers
    // positionally, so the error at index 1 of the second batch must resolve to
    // the second token *of that batch*, not of the whole list.
    expect(outcome.deadTokens).toEqual([`tok-${CHUNK + 1}`]);
    expect(outcome.accepted).toBe(CHUNK + 1);
  });

  it('counts a short reply rather than quietly reporting fewer', async () => {
    const { fn } = stubFetch({ data: [{ status: 'ok', id: 't-1' }] });

    const outcome = await sendExpoPush(['tok-1', 'tok-2'], content, { fetch: fn });

    expect(outcome.accepted).toBe(1);
    expect(outcome.rejected).toBe(1);
  });

  it('passes through the delivery controls a caller sets', async () => {
    const { fn, calls } = stubFetch({ data: [{ status: 'ok', id: 't-1' }] });

    await sendExpoPush(
      ['tok-1'],
      {
        ...content,
        channelId: 'daykeep-general-v3',
        collapseId: 'challenge:at-risk',
        priority: 'high',
        ttl: 3600,
        data: { route: '/challenge', key: 'challenge:at-risk' },
      },
      { fetch: fn, accessToken: 'secret' },
    );

    const [message] = calls[0].body as Record<string, unknown>[];
    expect(message).toMatchObject({
      channelId: 'daykeep-general-v3',
      // The server-side counterpart to the local scheduler's dedupe key: four
      // sends about one thing become one notification on the device.
      collapseId: 'challenge:at-risk',
      priority: 'high',
      ttl: 3600,
    });
    expect(calls[0].headers.Authorization).toBe('Bearer secret');
  });

  it('omits the controls it was not given', async () => {
    const { fn, calls } = stubFetch({ data: [{ status: 'ok', id: 't-1' }] });

    await sendExpoPush(['tok-1'], content, { fetch: fn });

    const [message] = calls[0].body as Record<string, unknown>[];
    expect(message).not.toHaveProperty('collapseId');
    expect(message).not.toHaveProperty('ttl');
    expect(calls[0].headers).not.toHaveProperty('Authorization');
  });

  it('does nothing at all with no recipients', async () => {
    const { fn, calls } = stubFetch({ data: [] });
    const outcome = await sendExpoPush([], content, { fetch: fn });

    expect(calls).toHaveLength(0);
    expect(outcome).toEqual({ accepted: 0, rejected: 0, deadTokens: [], tickets: [] });
  });
});

describe('fetchExpoReceipts', () => {
  it('separates delivered, dead, merely-failed and not-yet-known', async () => {
    const { fn } = stubFetch({
      data: {
        'ok-1': { status: 'ok' },
        'dead-1': { status: 'error', details: { error: 'DeviceNotRegistered' } },
        'oops-1': { status: 'error', details: { error: 'MessageRateExceeded' } },
      },
    });

    const verdict = await fetchExpoReceipts(['ok-1', 'dead-1', 'oops-1', 'unknown-1'], {
      fetch: fn,
    });

    expect(verdict.delivered).toEqual(['ok-1']);
    expect(verdict.fatal).toEqual(['dead-1']);
    expect(verdict.failed).toEqual(['oops-1']);
    // Expo simply has no answer yet. Treating this as delivered would drop the
    // row before the verdict that deletes a dead token ever arrived.
    expect(verdict.pending).toEqual(['unknown-1']);
  });

  it('keeps everything pending when the lookup fails', async () => {
    const failing = jest.fn(async () => {
      throw new Error('down');
    }) as unknown as PushDeps['fetch'];

    const verdict = await fetchExpoReceipts(['a', 'b'], { fetch: failing });

    expect(verdict.pending).toEqual(['a', 'b']);
    expect(verdict.fatal).toEqual([]);
  });

  it('asks for nothing when there is nothing to ask about', async () => {
    const { fn, calls } = stubFetch({ data: {} });
    await fetchExpoReceipts([], { fetch: fn });
    expect(calls).toHaveLength(0);
  });
});

describe('pruneDeadTokens', () => {
  it('deletes exactly the tokens it was given', async () => {
    const deleted: string[] = [];
    const admin = {
      from: () => ({
        delete: () => ({
          in: async (_column: string, values: string[]) => {
            deleted.push(...values);
            return { error: null };
          },
        }),
      }),
    };

    await expect(pruneDeadTokens(admin, ['tok-1', 'tok-2'])).resolves.toBe(2);
    expect(deleted).toEqual(['tok-1', 'tok-2']);
  });

  it('swallows a failure rather than failing the caller', async () => {
    const admin = {
      from: () => ({
        delete: () => ({
          in: async () => {
            throw new Error('db down');
          },
        }),
      }),
    };

    await expect(pruneDeadTokens(admin, ['tok-1'])).resolves.toBe(0);
  });

  it('does not issue a delete for an empty list', async () => {
    const from = jest.fn();
    await expect(pruneDeadTokens({ from } as never, [])).resolves.toBe(0);
    expect(from).not.toHaveBeenCalled();
  });
});

describe('recordTickets', () => {
  it('writes one row per accepted ticket, carrying its token', async () => {
    const rows: Record<string, unknown>[] = [];
    const admin = {
      from: () => ({
        insert: async (values: Record<string, unknown>[]) => {
          rows.push(...values);
          return { error: null };
        },
        delete: () => ({ in: async () => ({ error: null }) }),
      }),
    };

    const written = await recordTickets(
      admin,
      {
        tickets: [
          { id: 't-1', token: 'tok-1' },
          { id: 't-2', token: 'tok-2' },
        ],
      },
      1000,
    );

    expect(written).toBe(2);
    // The token rides along because a fatal receipt's whole value is knowing
    // which device to stop sending to.
    expect(rows).toEqual([
      { ticket_id: 't-1', token: 'tok-1', created_at: 1000, checked_at: null },
      { ticket_id: 't-2', token: 'tok-2', created_at: 1000, checked_at: null },
    ]);
  });

  it('writes nothing when nothing was accepted', async () => {
    const from = jest.fn();
    await expect(recordTickets({ from } as never, { tickets: [] }, 1000)).resolves.toBe(0);
    expect(from).not.toHaveBeenCalled();
  });

  it('swallows a failure — a lost ticket costs a receipt, not a notification', async () => {
    const admin = {
      from: () => ({
        insert: async () => {
          throw new Error('db down');
        },
        delete: () => ({ in: async () => ({ error: null }) }),
      }),
    };

    await expect(
      recordTickets(admin, { tickets: [{ id: 't-1', token: 'tok-1' }] }, 1000),
    ).resolves.toBe(0);
  });
});
