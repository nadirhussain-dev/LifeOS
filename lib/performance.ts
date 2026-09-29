/**
 * Startup instrumentation.
 *
 * The app had none — no `performance.now`, no `InteractionManager`, nothing —
 * which meant cold-start time was unknown, unbudgeted, and impossible to
 * regress against. A release that doubled it would have shipped silently, and
 * the only signal would have been reviews saying the app "feels slow".
 *
 * Deliberately tiny. This measures the boot gates the root layout already waits
 * on and reports one number; it is not a tracing framework, and it costs a
 * `Date.now()` per gate.
 *
 * **The number currently goes nowhere in release.** It was reported through a
 * sink that Sentry was the only thing to register, and Sentry has been removed;
 * the sink went with it rather than being left behind, for the reason
 * `lib/error-reporting.ts` gives at length. What survives is the measurement
 * and the budget, which are the parts worth keeping: a stated budget is what
 * makes "is startup slow?" answerable at all, and re-attaching a backend is one
 * line at the bottom of `reportStartupIfComplete`.
 */

export type MetricContext = Record<string, unknown>;

/**
 * The boot gates the root layout blocks render on. Named rather than free-form
 * so a typo cannot open a second, near-identical series that never lines up
 * with the first — the same reason FUNNEL_METRICS is a closed union.
 */
export const STARTUP_GATES = ['fonts', 'session', 'profile', 'database'] as const;
export type StartupGate = (typeof STARTUP_GATES)[number];

/**
 * What "fast enough" means, in milliseconds from process start to the first
 * frame the person can act on.
 *
 * 2000ms is the target, not the observed value. It is here so the number is
 * written down and can be failed against; without a stated budget "is startup
 * slow?" has no answer except an opinion.
 */
export const STARTUP_BUDGET_MS = 2000;

/**
 * When this module was first evaluated, which is as close to process start as
 * JS can observe. Not the true cold-start moment — the native side is already
 * up by then — so treat the number as a comparable series, not an absolute.
 */
const moduleLoadedAt = Date.now();

const gateTimings = new Map<StartupGate, number>();
let reported = false;

/**
 * Records that a boot gate has opened. Idempotent per gate: the root layout's
 * effects can re-run, and the *first* time a gate opened is the one that
 * matters — taking the last would quietly report a shorter startup than
 * happened.
 */
export function markStartupGate(gate: StartupGate, now: number = Date.now()): void {
  if (gateTimings.has(gate)) return;
  gateTimings.set(gate, now - moduleLoadedAt);
}

/** Elapsed ms for a gate, or null if it has not opened yet. */
export function startupGateTiming(gate: StartupGate): number | null {
  return gateTimings.get(gate) ?? null;
}

/** The one startup reading: how long it took, and what it is attributable to. */
export type StartupReport = { total: number; context: MetricContext };

/**
 * Reports cold start once every gate has opened, and does nothing until then.
 *
 * Returns the reading, or null if it is not yet time. Startup is the *slowest*
 * gate rather than the sum: the root layout awaits them concurrently, so adding
 * them up would report a number no user ever waited.
 *
 * It returns the context as well as the total now that there is no sink to hand
 * them to. That is what keeps the budget flag and the per-gate attribution
 * observable — they were only ever visible through the sink's third argument,
 * and deleting the sink without this would have deleted the coverage of both
 * while leaving the code that computes them.
 */
export function reportStartupIfComplete(): StartupReport | null {
  if (reported) return null;
  if (STARTUP_GATES.some((gate) => !gateTimings.has(gate))) return null;

  const timings = STARTUP_GATES.map((gate) => gateTimings.get(gate) ?? 0);
  const total = Math.max(...timings);
  reported = true;

  const context: MetricContext = {
    overBudget: total > STARTUP_BUDGET_MS,
    budgetMs: STARTUP_BUDGET_MS,
  };
  for (const gate of STARTUP_GATES) context[gate] = gateTimings.get(gate);

  // Dev only, because there is nowhere else for it to go. Silent in release
  // rather than pretending: see this file's header.
  if (__DEV__) console.log('[startup]', `${total}ms`, context);
  return { total, context };
}

/** Test seam: forgets every gate and the reported flag. */
export function resetStartupTimings(): void {
  gateTimings.clear();
  reported = false;
}
