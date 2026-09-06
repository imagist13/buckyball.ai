/**
 * Localized labels for the Electron menubar / tray menu.
 *
 * The tray lives in the main process, which has no access to the React
 * i18n bundle (`src/i18n/{en,zh}.ts`). We pick labels from the OS locale
 * via `app.getLocale()` instead. Kept as a pure function so it can be
 * unit-tested without an Electron runtime.
 */

export interface TrayMenuLabels {
  open: string;
  quit: string;
  tooltip: string;
}

const ZH: TrayMenuLabels = {
  open: '打开 CodePilot',
  quit: '退出 CodePilot',
  tooltip: 'CodePilot',
};

const EN: TrayMenuLabels = {
  open: 'Open CodePilot',
  quit: 'Quit CodePilot',
  tooltip: 'CodePilot',
};

export function getTrayMenuLabels(locale: string | undefined): TrayMenuLabels {
  if (!locale) return EN;
  return locale.toLowerCase().startsWith('zh') ? ZH : EN;
}
