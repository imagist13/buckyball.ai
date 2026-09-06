/**
 * Tiny shared module so both AppShell (gate) and FeatureAnnouncementDialog
 * (consumer) can reference the dismiss flag without AppShell having to
 * import the dialog itself. Keeping the constant in its own file is the
 * whole point — pulling it from FeatureAnnouncementDialog.tsx would defeat
 * the lazy-load (AppShell's compile graph would still drag in the dialog
 * + react-markdown + i18n strings on first paint).
 *
 * The localStorage key is the legacy v0.48 string and must NOT change
 * without a migration; flipping it would re-show the announcement to
 * every existing user who already dismissed it.
 */
export const ANNOUNCEMENT_KEY = 'codepilot:announcement:v0.48-agent-engine';
