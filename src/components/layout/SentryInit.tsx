"use client";

import { useEffect } from "react";
import { filterTelemetryIntegrations, resolveTelemetryConfig, TELEMETRY_IGNORE_ERRORS } from "@/lib/telemetry/contract";
import { sanitizeTelemetryBreadcrumb, sanitizeTelemetryEvent } from "@/lib/telemetry/sanitize";
import { createTelemetrySmokeError, telemetrySmokeEnabled } from "@/lib/telemetry/smoke";

/**
 * Client-side Sentry initialization component.
 * Must be rendered in the client tree (inside a "use client" boundary).
 * No-ops gracefully when NEXT_PUBLIC_SENTRY_DSN is not set.
 */
export function SentryInit() {
  useEffect(() => {
    // Check user opt-out
    let optedOut = false;
    try {
      optedOut = localStorage.getItem("codepilot:sentry-disabled") === "true";
    } catch {
      /* ignore */
    }
    const config = resolveTelemetryConfig({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      channel: process.env.NEXT_PUBLIC_CODEPILOT_CHANNEL,
      version: process.env.NEXT_PUBLIC_APP_VERSION,
      nodeEnv: process.env.NODE_ENV,
      optedOut,
    });
    if (!config.enabled) return;

    // Dynamic import to avoid bundling Sentry when DSN is absent
    import("@sentry/browser").then((Sentry) => {
      if (Sentry.isInitialized()) return;
      Sentry.init({
        dsn: config.dsn,
        environment: config.environment,
        release: config.release,
        sendDefaultPii: false,
        tracesSampleRate: 0,
        integrations: (defaults) => filterTelemetryIntegrations('renderer', defaults),
        beforeBreadcrumb(breadcrumb) {
          return sanitizeTelemetryBreadcrumb(breadcrumb);
        },
        ignoreErrors: TELEMETRY_IGNORE_ERRORS,
        beforeSend(event) {
          // Respect opt-out
          try {
            if (localStorage.getItem("codepilot:sentry-disabled") === "true") return null;
          } catch {
            /* ignore */
          }
          return sanitizeTelemetryEvent(event, {
            layer: 'renderer',
            channel: config.channel,
            platform: navigator.platform,
          });
        },
      });
      if (telemetrySmokeEnabled(process.env.NEXT_PUBLIC_CODEPILOT_TELEMETRY_SMOKE)) {
        Sentry.captureException(createTelemetrySmokeError('renderer'));
        void Sentry.flush(5_000);
      }
    }).catch(() => {
      /* Sentry not available */
    });
  }, []);

  return null;
}
