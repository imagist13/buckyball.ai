import type {
  CanonicalCapabilityRef,
  ContextFragment,
  RuntimeOverlayRecord,
  RuntimeProjection,
} from './contracts';
import { validateRuntimeProjection } from './validation';

export interface BuildRuntimeProjectionInput {
  readonly runtimeId: string;
  readonly contextFragments?: readonly ContextFragment[];
  readonly capabilities?: readonly CanonicalCapabilityRef[];
  readonly executableCapabilityIds?: ReadonlySet<string>;
  readonly unavailableReasons?: RuntimeProjection['unavailableReasons'];
  readonly assetRefs?: RuntimeProjection['assetRefs'];
  readonly overlay?: RuntimeOverlayRecord;
}

/**
 * Projects canonical capabilities without claiming unsupported execution.
 * Draft/pending entries remain perceptible-only; stable entries must have
 * already passed the reference validation contract.
 */
export function buildRuntimeProjection(
  input: BuildRuntimeProjectionInput,
): RuntimeProjection {
  const executable: CanonicalCapabilityRef[] = [];
  const perceptibleOnly: CanonicalCapabilityRef[] = [];
  const executableIds = input.executableCapabilityIds ?? new Set<string>();

  for (const capability of input.capabilities ?? []) {
    if (
      capability.referenceStatus === 'executable'
      && executableIds.has(capability.id)
    ) {
      executable.push(capability);
    } else {
      perceptibleOnly.push(capability);
    }
  }

  const projection: RuntimeProjection = {
    runtimeId: input.runtimeId,
    contextFragments: input.contextFragments ?? [],
    executableCapabilities: executable,
    perceptibleOnlyCapabilities: perceptibleOnly,
    unavailableReasons: input.unavailableReasons ?? [],
    assetRefs: input.assetRefs ?? [],
    ...(input.overlay ? { overlay: input.overlay } : {}),
  };
  validateRuntimeProjection(projection);
  return projection;
}
