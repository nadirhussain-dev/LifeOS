import {
  STARTUP_BUDGET_MS,
  STARTUP_GATES,
  markStartupGate,
  reportStartupIfComplete,
  resetMetricSink,
  resetStartupTimings,
  setMetricSink,
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
 */

const sink = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  resetStartupTimings();
  setMetricSink(sink);
});

afterEach(() => resetMetricSink());

/** Opens every gate but the one named, so a test can control the last one. */
function openAllExcept(except: (typeof STARTUP_GATES)[number], at: number) {
  for (const gate of STARTUP_GATES) if (gate !== except) markStartupGate(gate, at);
}

describe('reporting', () => {
  it('reports nothing until every gate has opened', () => {
    openAllExcept('database', Date.now());

    expect(reportStartupIfComplete()).toBeNull();
    expect(sink).not.toHaveBeenCalled();
  });

  it('reports once every gate is open', () => {
    for (const gate of STARTUP_GATES) markStartupGate(gate, Date.now());

    expect(reportStartupIfComplete()).not.toBeNull();
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toBe('app.startup');
  });

  it('reports only once, however often it is called', () => {
    // The root layout's effects re-run. A metric that fires per render turns
    // one cold start into a series whose average means nothing.
    for (const gate of STARTUP_GATES) markStartupGate(gate, Date.now());

    reportStartupIfComplete();
    reportStartupIfComplete();
    reportStartupIfComplete();

    expect(sink).toHaveBeenCalledTimes(1);
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

    const total = reportStartupIfComplete();
    const [, reported] = sink.mock.calls[0];

    // Within a few ms of the slowest gate, and nowhere near their sum (850).
    expect(total).toBeGreaterThanOrEqual(390);
    expect(total).toBeLessThan(500);
    expect(reported).toBe(total);
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

    reportStartupIfComplete();
    const [, , context] = sink.mock.calls[0];

    expect(context.overBudget).toBe(true);
    expect(context.budgetMs).toBe(STARTUP_BUDGET_MS);
  });

  it('does not flag a start inside it', () => {
    for (const gate of STARTUP_GATES) markStartupGate(gate, Date.now());

    reportStartupIfComplete();
    const [, , context] = sink.mock.calls[0];

    expect(context.overBudget).toBe(false);
  });

  it('carries every gate through so a slow start can be attributed', () => {
    // "Startup got slower" is not actionable; "the database gate got slower"
    // is. Without the per-gate breakdown the metric can only raise an alarm it
    // cannot explain.
    for (const gate of STARTUP_GATES) markStartupGate(gate, Date.now());

    reportStartupIfComplete();
    const [, , context] = sink.mock.calls[0];

    for (const gate of STARTUP_GATES) expect(typeof context[gate]).toBe('number');
  });
});

describe('without a sink', () => {
  it('is inert rather than throwing', () => {
    // Dev and unconfigured builds never register one. Startup measurement must
    // never be the thing that stops the app booting.
    resetMetricSink();
    for (const gate of STARTUP_GATES) markStartupGate(gate, Date.now());

    expect(() => reportStartupIfComplete()).not.toThrow();
  });
});
