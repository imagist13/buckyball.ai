import {
  HARNESS_CAPABILITIES,
  type CapabilityContract,
} from '@/lib/harness/capability-contract';
import {
  capabilityMatrixForRuntime,
  type CapabilityMatrixCell,
} from '@/lib/harness/capability-matrix';
import { RUNTIME_IDS, type RuntimeId } from '@/lib/runtime/runtime-id';
import {
  requireRuntimeRegistration,
} from '@/lib/runtime/runtime-catalog';
import type { CanonicalCapabilityRef } from '../contracts';
import {
  DescriptorRegistry,
  type RuntimeCapabilityDeclaration,
  type RuntimeDescriptor,
} from '../registry';
import { validateCanonicalCapability } from '../validation';

function canonicalCapability(
  capability: CapabilityContract,
): CanonicalCapabilityRef {
  const referenceExposure = capability.exposure.native;
  const referenceStatus: CanonicalCapabilityRef['referenceStatus'] =
    referenceExposure.kind !== 'unsupported'
      ? 'executable'
      : capability.status === 'unsupported'
        ? 'rejected'
        : 'pending';
  const canonical: CanonicalCapabilityRef = {
    id: capability.id,
    maturity: capability.status === 'live' ? 'stable' : 'draft',
    referenceStatus,
    ...(referenceStatus === 'executable'
      ? {}
      : {
        reason:
          capability.deferredReason
          ?? referenceExposure.notes
          ?? 'The CodePilot reference implementation is not executable.',
      }),
  };
  validateCanonicalCapability(canonical);
  return canonical;
}

function declaration(
  capability: CapabilityContract,
  cell: CapabilityMatrixCell,
): RuntimeCapabilityDeclaration {
  const canonical = canonicalCapability(capability);
  const registration = requireRuntimeRegistration(cell.runtimeId);
  const exposure = capability.exposure[registration.exposureKey];
  return {
    ...canonical,
    execution: cell.status,
    exposureKind: exposure.kind,
    ...(cell.status === 'executable'
      ? {}
      : {
        reason:
          cell.statusLine
          || exposure.notes
          || capability.deferredReason
          || 'This Runtime does not mount the capability.',
      }),
  };
}

export function buildRuntimeDescriptor(runtimeId: RuntimeId): RuntimeDescriptor {
  const registration = requireRuntimeRegistration(runtimeId);
  const matrix = capabilityMatrixForRuntime(runtimeId);
  const byCapability = new Map(
    matrix.map((cell) => [cell.capabilityId, cell]),
  );
  const capabilities = HARNESS_CAPABILITIES.map((capability) => {
    const cell = byCapability.get(capability.id);
    if (!cell) {
      throw new Error(
        `Runtime "${runtimeId}" has no matrix cell for "${capability.id}".`,
      );
    }
    return declaration(capability, cell);
  });
  return {
    id: registration.id,
    displayName: registration.displayName.en,
    integrationLevel: registration.integrationLevel,
    capabilities,
    projectionModes: registration.projectionModes,
    sessionDriverId: registration.driverId,
    eventContract: 'canonical-runtime-events-v1',
    permissionContract: 'canonical-runtime-permissions-v1',
    artifactContract: 'canonical-artifacts-v1',
    packagedRegistration: registration.packagedRegistration,
  };
}

const runtimeDescriptors = new DescriptorRegistry<RuntimeDescriptor>(
  RUNTIME_IDS.map(buildRuntimeDescriptor),
);
runtimeDescriptors.seal();

export function getRuntimeDescriptor(id: string): RuntimeDescriptor | undefined {
  return runtimeDescriptors.get(id);
}

export function requireRuntimeDescriptor(id: string): RuntimeDescriptor {
  return runtimeDescriptors.require(id);
}

export function listRuntimeDescriptors(): readonly RuntimeDescriptor[] {
  return runtimeDescriptors.list();
}

/**
 * Full Reference contract:
 *
 * stable canonical capabilities must be executable in CodePilot. Draft
 * entries may be pending and remain visible to diagnostics, but cannot enter
 * stable coverage until the reference implementation is real.
 */
export function assertCodePilotFullReference(): void {
  const descriptor = requireRuntimeDescriptor('codepilot_runtime');
  if (descriptor.integrationLevel !== 'full') {
    throw new Error('CodePilot Runtime must be the Full Reference Runtime.');
  }
  for (const capability of descriptor.capabilities) {
    if (
      capability.maturity === 'stable'
      && (
        capability.referenceStatus !== 'executable'
        || capability.execution !== 'executable'
      )
    ) {
      throw new Error(
        `Stable capability "${capability.id}" is not executable in `
        + 'the CodePilot Full Reference Runtime.',
      );
    }
  }
}

assertCodePilotFullReference();
