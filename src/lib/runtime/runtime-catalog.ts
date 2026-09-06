/**
 * Compile-time Runtime registration catalog.
 *
 * The chat/database wire keeps the existing three stable IDs, while every
 * consumer derives ordering, labels and driver mapping from this catalog.
 * Adding a Runtime is therefore a registration change instead of another
 * hand-written union/switch. Runtime implementations are still bundled and
 * explicitly registered; this is not a dynamic third-party code loader.
 */

export type RuntimeExposureKey =
  | 'claudecode_sdk'
  | 'native'
  | 'codex_proxy';

export type RuntimeBrandIcon = 'anthropic' | 'codepilot' | 'openai';

export interface RuntimeRegistration {
  readonly id: string;
  readonly displayName: {
    readonly zh: string;
    readonly en: string;
  };
  readonly integrationLevel: 'bridge' | 'full';
  readonly driverId: string;
  readonly exposureKey: RuntimeExposureKey;
  readonly projectionModes: readonly (
    | 'context'
    | 'mcp_descriptor'
    | 'skill_descriptor'
    | 'asset_reference'
  )[];
  readonly translationKeys: {
    readonly label: string;
    readonly description: string;
  };
  readonly icon: RuntimeBrandIcon;
  readonly packagedRegistration: 'explicit';
}

export const BUILTIN_RUNTIME_REGISTRATIONS = [
  {
    id: 'claude_code',
    displayName: { zh: 'Claude Code', en: 'Claude Code' },
    integrationLevel: 'bridge',
    driverId: 'claude-code-sdk',
    exposureKey: 'claudecode_sdk',
    projectionModes: ['context', 'mcp_descriptor', 'skill_descriptor', 'asset_reference'],
    translationKeys: {
      label: 'runtimeSelector.claudeCode',
      description: 'runtimeSelector.claudeCodeDesc',
    },
    icon: 'anthropic',
    packagedRegistration: 'explicit',
  },
  {
    id: 'codepilot_runtime',
    displayName: { zh: 'CodePilot', en: 'CodePilot' },
    integrationLevel: 'full',
    driverId: 'native',
    exposureKey: 'native',
    projectionModes: ['context', 'mcp_descriptor', 'skill_descriptor', 'asset_reference'],
    translationKeys: {
      label: 'runtimeSelector.codepilotRuntime',
      description: 'runtimeSelector.codepilotRuntimeDesc',
    },
    icon: 'codepilot',
    packagedRegistration: 'explicit',
  },
  {
    id: 'codex_runtime',
    displayName: { zh: 'Codex', en: 'Codex' },
    integrationLevel: 'bridge',
    driverId: 'codex_runtime',
    exposureKey: 'codex_proxy',
    projectionModes: ['context', 'mcp_descriptor', 'skill_descriptor', 'asset_reference'],
    translationKeys: {
      label: 'runtimeSelector.codexRuntime',
      description: 'runtimeSelector.codexRuntimeDesc',
    },
    icon: 'openai',
    packagedRegistration: 'explicit',
  },
] as const satisfies readonly RuntimeRegistration[];

export type RegisteredRuntimeId =
  (typeof BUILTIN_RUNTIME_REGISTRATIONS)[number]['id'];

export type BuiltinRuntimeRegistration =
  (typeof BUILTIN_RUNTIME_REGISTRATIONS)[number];

export function getRuntimeRegistration(
  id: unknown,
): BuiltinRuntimeRegistration | undefined {
  if (typeof id !== 'string') return undefined;
  return BUILTIN_RUNTIME_REGISTRATIONS.find((entry) => entry.id === id);
}

export function requireRuntimeRegistration(
  id: unknown,
): BuiltinRuntimeRegistration {
  const registration = getRuntimeRegistration(id);
  if (!registration) {
    throw new Error(`Runtime "${String(id)}" is not registered.`);
  }
  return registration;
}

export function getRuntimeDisplayName(
  id: RegisteredRuntimeId,
  language: 'zh' | 'en',
): string {
  return requireRuntimeRegistration(id).displayName[language];
}

/**
 * Packaged startup gate. Call this after concrete drivers are registered.
 * An entry in the user-facing catalog without a bundled driver is a build
 * error, never an option that silently falls back to a different Runtime.
 */
export function assertPackagedRuntimeDrivers(
  hasDriver: (driverId: string) => boolean,
): void {
  for (const registration of BUILTIN_RUNTIME_REGISTRATIONS) {
    if (!hasDriver(registration.driverId)) {
      throw new Error(
        `Registered Runtime "${registration.id}" is missing packaged driver `
        + `"${registration.driverId}".`,
      );
    }
  }
}
