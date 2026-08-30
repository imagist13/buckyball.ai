import path from 'path';

/** Electron resolves the platform Documents directory; callers never guess it. */
export function resolveDefaultAssistantHome(documentsPath: string): string {
  return path.join(documentsPath, 'CodePilot', 'Assistant');
}
