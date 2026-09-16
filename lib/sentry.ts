import * as Sentry from '@sentry/react-native';

import { env } from '@/lib/env';
import { setErrorSink } from '@/lib/error-reporting';
import { setMetricSink } from '@/lib/performance';

let initialized = false;

/**
 * Initializes Sentry when a DSN is present and routes the app's error choke
 * point (reportError → setErrorSink) to it. No-ops when EXPO_PUBLIC_SENTRY_DSN
 * is absent, so dev and unconfigured builds keep local-only reporting (console
 * + dev banner) with zero network. Call once at startup.
 */
/** A real Sentry DSN looks like https://<publicKey>@<host>/<projectId>. This
 * rejects blanks AND placeholders like "https://sentry.io/your-dsn" (no `@`),
 * which would otherwise make Sentry.init throw "Invalid Sentry Dsn" on boot. */
function looksLikeDsn(dsn: string): boolean {
  return /^https?:\/\/[^@\s]+@[^/\s]+\/.+$/.test(dsn);
}

export function initSentry(): void {
  if (initialized) return;
  const dsn = env.EXPO_PUBLIC_SENTRY_DSN;
  if (!looksLikeDsn(dsn)) return; // no/placeholder DSN → local-only reporting

  try {
    Sentry.init({
      dsn,
      // Keep it lean: errors only, no perf tracing by default.
      tracesSampleRate: 0,
    });
    setErrorSink((error, context) => {
      Sentry.captureException(error, context ? { extra: context } : undefined);
    });
    // Startup timing goes to the same place, as a measurement rather than an
    // exception. `tracesSampleRate` is 0 by design (see above), so this is sent
    // as one breadcrumb-plus-message rather than a span — enough to trend cold
    // start and to see which gate moved, without turning on tracing.
    setMetricSink((name, milliseconds, context) => {
      Sentry.captureMessage(name, {
        level: context?.overBudget ? 'warning' : 'info',
        extra: { ...context, milliseconds },
      });
    });
    initialized = true;
  } catch {
    // Invalid DSN or SDK init failure — never let error reporting crash boot.
  }
}
