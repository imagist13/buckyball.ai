/** Renderer capture facade. Initialization and privacy policy stay centralized. */
export function captureRendererException(error: unknown, category = 'RENDERER_ERROR'): void {
  if (
    process.env.NODE_ENV !== 'production'
    || process.env.NEXT_PUBLIC_CODEPILOT_CHANNEL !== 'stable'
  ) return;

  import('@sentry/browser').then((Sentry) => {
    if (!Sentry.isInitialized()) return;
    Sentry.withScope((scope) => {
      scope.setTag('error.category', category);
      scope.setTag('error.outcome', 'product_fault');
      scope.setTag('error.runtime', 'host_application');
      Sentry.captureException(error);
    });
  }).catch(() => { /* telemetry is never allowed to break the UI */ });
}
