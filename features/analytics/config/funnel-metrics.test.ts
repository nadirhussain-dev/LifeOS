import { readFileSync } from 'node:fs';
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
const MIGRATION = join(
  __dirname,
  '..',
  '..',
  '..',
  'supabase',
  'migrations',
  '0066_funnel_metrics.sql',
);

function serverMetrics(): string[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  const body = sql.slice(
    sql.indexOf('create or replace function public.funnel_metrics()'),
    sql.indexOf(']::text[];'),
  );
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
