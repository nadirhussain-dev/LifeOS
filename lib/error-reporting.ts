import { useDevErrorStore } from '@/lib/dev-error-store';

export type ErrorContext = Record<string, unknown> & { scope?: string };

/**
 * The single choke point for reporting caught / non-fatal errors (failed
 * queries & mutations, render errors caught by the ErrorBoundary, swallowed
 * catches worth surfacing). In dev it logs and drives the on-device
 * DevErrorBanner.
 *
 * **In release it reaches nobody.** This used to hand the error to a
 * registered sink, and Sentry was the only thing that ever registered one; with
 * Sentry removed there is no crash or error reporting in production at all, and
 * `console.error` on somebody's phone is not a report. That is a deliberate
 * choice rather than an oversight, and it is the reason the seam went with the
 * SDK instead of being left behind: a `setErrorSink` nothing calls reads as
 * "reporting is wired up", which is the opposite of true.
 *
 * Every call site stays. Keeping one choke point is what makes adding a backend
 * later a single edit here rather than an audit of two hundred catch blocks.
 */
export function reportError(error: unknown, context?: ErrorContext): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[error]', context?.scope ?? '', message, error);

  if (__DEV__) {
    useDevErrorStore.getState().setError(context?.scope ? `${context.scope}: ${message}` : message);
  }
}
