import { getSetting } from '@/lib/db';
import type { RuntimeId } from '@/lib/runtime/runtime-id';
import { createCodePilotSecretStore } from '../codepilot-secret-store';
import { FileHarnessRepository } from '../repository/file-repository';
import {
  projectCanonicalRepository,
  type CanonicalRuntimeHarness,
} from './repository-projection';

export const HARNESS_HOME_ROOT_SETTING = 'harness_home_root';

export type ConfiguredHarnessHomeResult =
  | {
    readonly status: 'unconfigured';
    readonly reason: string;
  }
  | {
    readonly status: 'unavailable';
    readonly root: string;
    readonly reason: string;
  }
  | {
    readonly status: 'loaded';
    readonly root: string;
    readonly harness: CanonicalRuntimeHarness;
    readonly secrets: readonly {
      readonly portableRef: string;
      readonly status: 'available' | 'unresolved' | 'unavailable';
      readonly mutable: boolean;
      readonly reason?: string;
    }[];
  };

/**
 * Resolve the configured canonical repository read-only. Chat callers may
 * degrade to legacy scanners on `unavailable`, while diagnostics keep the
 * exact reason visible. Secret values are never returned.
 */
export function loadConfiguredHarnessHome(
  runtimeId: RuntimeId,
  options: {
    readonly userPrompt?: string;
    readonly projectId?: string;
    readonly assistantId?: string;
    readonly explicitMethodIds?: readonly string[];
    readonly creativeProjectId?: string;
  } = {},
): ConfiguredHarnessHomeResult {
  const configuredRoot = getSetting(HARNESS_HOME_ROOT_SETTING)?.trim();
  if (!configuredRoot) {
    return {
      status: 'unconfigured',
      reason: 'No canonical Harness Home root is configured.',
    };
  }

  let repository: FileHarnessRepository | undefined;
  try {
    repository = FileHarnessRepository.open(configuredRoot, {
      mode: 'readonly',
    });
    const harness = projectCanonicalRepository({
      repository,
      runtimeId,
      userPrompt: options.userPrompt,
      scopeContext: {
        ...(options.projectId ? { projectId: options.projectId } : {}),
        ...(options.assistantId ? { assistantId: options.assistantId } : {}),
      },
      explicitMethodIds: options.explicitMethodIds,
      creativeProjectId: options.creativeProjectId,
    });
    const secretStore = createCodePilotSecretStore();
    const secrets = harness.secretRefs.map((ref) => {
      try {
        const metadata = secretStore.get(ref);
        return {
          portableRef: metadata.portableRef,
          status: metadata.status,
          mutable: metadata.mutable,
          ...(metadata.reason ? { reason: metadata.reason } : {}),
        };
      } catch (error) {
        return {
          portableRef: `secret://${ref.namespace}/${ref.scope}/${ref.key}?v=${ref.version}`,
          status: 'unavailable' as const,
          mutable: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    });
    return {
      status: 'loaded',
      root: repository.root,
      harness,
      secrets,
    };
  } catch (error) {
    return {
      status: 'unavailable',
      root: configuredRoot,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    repository?.close();
  }
}
