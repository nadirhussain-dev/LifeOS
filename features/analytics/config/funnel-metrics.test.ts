import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { FUNNEL_METRICS, PRE_CONSENT_METRICS } from '@/features/analytics/config/funnel-metrics';

/**
 * The client's metric list against the server's.
 *
 * Two copies of one list is a drift waiting to happen, and this drift is
 * silent in the worst direction: `record_funnel` skips a metric it does not
 * recognise rather than failing, so a name added here and not to the migration
 * reports into nothing at all. Nobody notices until somebody opens a chart
 * weeks later and finds one line missing — at which point the natural reading
 * is "that step has no traffic", which is the opposite of the truth.
 */
const MIGRATIONS = join(__dirname, '..', '..', '..', 'supabase', 'migrations');

const SIGNATURE = 'create or replace function public.funnel_metrics()';

/**
 * The allowlist as the database would resolve it — the **last** migration that
 * redefines the function, not a pinned filename.
 *
 * It was pinned to `0066_funnel_metrics.sql`, which was right until something
 * else added a metric. `create or replace` means the newest definition wins at
 * runtime, so a test reading the oldest one compares the client against a
 * function the server has already replaced: it fails when the two agree and
 * passes when they do not, which is worse than not testing it at all.
 *
 * Filename order is the apply order — `migrate.mjs` and `check-migrations.mjs`
 * both sort the same way — so the last file containing the signature holds the
 * live body.
 */
function serverMetrics(): string[] {
  const file = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .reverse()
    .find((name) => readFileSync(join(MIGRATIONS, name), 'utf8').includes(SIGNATURE));

  if (!file) throw new Error(`no migration defines ${SIGNATURE}`);

  const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
  const start = sql.indexOf(SIGNATURE);
  const body = sql.slice(start, sql.indexOf(']::text[];', start));
  return [...body.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
}

describe('funnel metrics', () => {
  it('matches the allowlist the server actually enforces', () => {
    // Sorted, because the grouping in each file is for a human reader and the
    // two do not have to agree on order — only on membership.
    expect([...FUNNEL_METRICS].sort()).toEqual(serverMetrics().sort());
  });

  it('has no duplicates', () => {
    expect(new Set(FUNNEL_METRICS).size).toBe(FUNNEL_METRICS.length);
  });

  it('only lets real metrics accrue before consent', () => {
    for (const metric of PRE_CONSENT_METRICS) {
      expect(FUNNEL_METRICS).toContain(metric);
    }
  });

  it('never buffers an ad metric before consent', () => {
    // The exception exists because the consent card deliberately waits for
    // onboarding to end. Ads start three days after install, by which point the
    // question has long been answered — so widening the exception to cover them
    // would be collecting before consent with no reason that survives reading.
    for (const metric of PRE_CONSENT_METRICS) {
      expect(metric.startsWith('ad_')).toBe(false);
    }
  });
});
