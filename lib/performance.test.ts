import {
  STARTUP_BUDGET_MS,
  STARTUP_GATES,
  markStartupGate,
  reportStartupIfComplete,
  resetStartupTimings,
  startupGateTiming,
} from '@/lib/performance';

/**
 * Startup instrumentation.
 *
 * The value of this module is entirely in the number being *right*: a
 * cold-start metric that quietly under-reports is worse than none, because it
 * turns a regression into a green dashboard. The two ways it could lie are
 * summing concurrent gates (reporting a wait nobody had) and taking the last
 * timestamp for a gate whose effect re-ran (reporting a wait shorter than the
 * one that happened). Both are pinned below.
 *
 * These read the return value rather than a registered sink. The sink was
 * Sentry's and went with it, so the reading is handed back to the caller
 * instead — which is what keeps the budget flag and the per-gate attribution
 * observable at all.
 */

beforeEach(() => {
  resetStartupTimings();
});

/** Opens every gate but the one named, so a test can control the last one. */
function openAllExcept(except: (typeof STARTUP_GATES)[number], at: number) {
  for (const gate of STARTUP_GATES) if (gate !== except) markStartupGate(gate, at);
}

describe('reporting', () => {
  it('reports nothing until every gate has opened', () => {
    openAllExcept('database', Date.now());

    expect(reportStartupIfComplete()).toBeNull();
  });

  it('reports once every gate is open', () => {
    for (const gate of STARTUP_GATES) markStartupGate(gate, Date.now());

    const report = reportStartupIfComplete();
    expect(report).not.toBeNull();
    expect(typeof report!.total).toBe('number');
  });

  it('reports only once, however often it is called', () => {
    // The root layout's effects re-run. A metric that fires per render turns
    // one cold start into a series whose average means nothing.
    for (const gate of STARTUP_GATES) markStartupGate(gate, Date.now());

    expect(reportStartupIfComplete()).not.toBeNull();
    // Null on every call after the first, which is how "reported once" is
    // observable now that there is no sink to count calls on.
    expect(reportStartupIfComplete()).toBeNull();
    expect(reportStartupIfComplete()).toBeNull();
  });
});

describe('the reported duration', () => {
  it('is the slowest gate, not the sum of them', () => {
    // The gates are awaited concurrently. Summing four 500ms gates would report
    // a two-second startup that nobody experienced — and would breach the
    // budget on a boot that was comfortably inside it.
    const start = Date.now();
    markStartupGate('fonts', start + 100);
    markStartupGate('session', start + 200);
    markStartupGate('profile', start + 150);
    markStartupGate('database', start + 400);

    const total = reportStartupIfComplete()!.total;

    /*
     * Asserted against the gates themselves rather than against 400.
     *
     * Every timing is measured from `moduleLoadedAt`, which is fixed when this
     * module is first imported — not when the test runs. The old bounds
     * (>= 390, < 500) therefore held only while those two moments were close
     * together, which is true running this file alone and false in a full
     * parallel suite: the module can be minutes old by the time the test
     * executes, and `total` is then `(start + 400) - moduleLoadedAt`, far past
     * 500. It failed exactly that way once during this change.
     *
     * The property has nothing to do with wall-clock distance from import. It
     * is that the reported number is the largest gate and not their sum.
     */
    const timings = STARTUP_GATES.map((gate) => startupGateTiming(gate) ?? 0);
    expect(total).toBe(Math.max(...timings));
    expect(total).toBeLessThan(timings.reduce((sum, value) => sum + value, 0));
    // ...and the gates really were staggered, or the line above proves nothing.
    expect(new Set(timings).size).toBeGreaterThan(1);
  });

  it('keeps the first time a gate opened, not the last', () => {
    // `markStartupGate` is called from effects that re-run. Overwriting would
    // report the moment of the most recent render rather than the moment the
    // gate actually opened, which always under-reports.
    const start = Date.now();
    markStartupGate('fonts', start + 100);
    markStartupGate('fonts', start + 5000);

    const first = startupGateTiming('fonts') ?? 0;
    expect(first).toBeLessThan(500);
  });
});

describe('the budget', () => {
  it('flags a start that breached it', () => {
    const start = Date.now();
    openAllExcept('database', start);
    markStartupGate('database', start + STARTUP_BUDGET_MS + 500);

    const { context } = reportStartupIfComplete()!;

    expect(context.overBudget).toBe(true);
    expect(context.budgetMs).toBe(STARTUP_BUDGET_MS);
  });

  it('does not flag a start inside it', () => {
    for (const gate of STARTUP_GATES) markStartupGate(gate, Date.now());

    const { context } = reportStartupIfComplete()!;

    expect(context.overBudget).toBe(false);
  });

  it('carries every gate through so a slow start can be attributed', () => {
    // "Startup got slower" is not actionable; "the database gate got slower"
    // is. Without the per-gate breakdown the metric can only raise an alarm it
    // cannot explain.
    for (const gate of STARTUP_GATES) markStartupGate(gate, Date.now());

    const { context } = reportStartupIfComplete()!;

    for (const gate of STARTUP_GATES) expect(typeof context[gate]).toBe('number');
  });
});
