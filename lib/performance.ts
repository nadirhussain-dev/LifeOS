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
 * The sink mirrors `lib/error-reporting.ts` exactly — registered once at
 * startup, absent in dev and in unconfigured builds — so there is one way to
 * add a telemetry backend in this codebase rather than two.
 */

export type MetricContext = Record<string, unknown>;

type MetricSink = (name: string, milliseconds: number, context?: MetricContext) => void;

let sink: MetricSink | null = null;

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

/** Registers the metric sink (e.g. Sentry). Mirrors `setErrorSink`. */
export function setMetricSink(fn: MetricSink): void {
  sink = fn;
}

/** Test seam: drops the sink so one suite cannot leak into the next. */
export function resetMetricSink(): void {
  sink = null;
}

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

/**
 * Reports cold start once every gate has opened, and does nothing until then.
 *
 * Returns the reported duration, or null if it is not yet time. Startup is the
 * *slowest* gate rather than the sum: the root layout awaits them concurrently,
 * so adding them up would report a number no user ever waited.
 */
export function reportStartupIfComplete(): number | null {
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

  sink?.('app.startup', total, context);
  return total;
}

/** Test seam: forgets every gate and the reported flag. */
export function resetStartupTimings(): void {
  gateTimings.clear();
  reported = false;
}
