import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { getSetting, setSetting } from '@/lib/db';
import {
  isRuntimeId,
  type RuntimeId,
} from '@/lib/runtime/runtime-id';
import { requireRuntimeDescriptor } from '@/lib/harness-home/runtime/descriptor';
import {
  HARNESS_HOME_ROOT_SETTING,
  loadConfiguredHarnessHome,
} from '@/lib/harness-home/runtime/configured';
import { FileHarnessRepository } from '@/lib/harness-home/repository/file-repository';
import { projectCanonicalRepository } from '@/lib/harness-home/runtime/repository-projection';
import {
  CREATIVE_METHOD_MEDIA_TYPE,
} from '@/lib/harness-home/design-method';
import {
  TASTE_MEMORY_MEDIA_TYPE,
} from '@/lib/harness-home/taste-memory';
import {
  CREATIVE_PROJECT_MEDIA_TYPE,
} from '@/lib/harness-home/creative-project';

function requestedRuntime(request: NextRequest): RuntimeId | null {
  const candidate =
    request.nextUrl.searchParams.get('runtime') ?? 'codepilot_runtime';
  return isRuntimeId(candidate) ? candidate : null;
}

/**
 * Code-level Harness Home diagnostics. It intentionally returns metadata and
 * source breadcrumbs only: Memory/identity contents and resolved Secret
 * values never cross this API boundary.
 */
export async function GET(request: NextRequest) {
  const runtimeId = requestedRuntime(request);
  if (!runtimeId) {
    return NextResponse.json(
      { error: 'Unknown or unregistered Runtime.' },
      { status: 400 },
    );
  }
  const descriptor = requireRuntimeDescriptor(runtimeId);
  const result = loadConfiguredHarnessHome(runtimeId);
  if (result.status !== 'loaded') {
    return NextResponse.json({
      configured: result.status !== 'unconfigured',
      status: result.status,
      runtime: descriptor,
      ...(result.status === 'unavailable' ? { root: result.root } : {}),
      reason: result.reason,
    });
  }
  return NextResponse.json({
    configured: true,
    status: 'loaded',
    root: result.root,
    runtime: descriptor,
    repository: {
      generation: result.harness.generation,
      contextSections: result.harness.sections.map((section) => ({
        id: section.id,
        kind: section.kind,
        path: section.path,
        provenance: section.provenance,
      })),
      definitions: result.harness.definitions,
      assetRefs: result.harness.projection.assetRefs,
      unavailableCapabilities:
        result.harness.projection.unavailableReasons,
      designMethod: {
        methodCount:
          result.harness.sections.filter(
            (section) => section.kind === 'creative_method',
          ).length,
        selectedMethodIds: result.harness.diagnostics.selectedMethodIds,
        tasteConflictKeys: result.harness.diagnostics.tasteConflictKeys,
        invalidTasteMemoryIds:
          result.harness.diagnostics.invalidTasteMemoryIds,
        creativeProjectId: result.harness.diagnostics.creativeProjectId,
      },
    },
    secrets: result.secrets,
  });
}

/**
 * Configure an existing canonical repository. Creation/import remains an
 * explicit workflow; this endpoint never creates a directory or modifies
 * external Harness sources.
 */
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null) as {
    root?: unknown;
  } | null;
  if (!body || typeof body.root !== 'string' || !path.isAbsolute(body.root)) {
    return NextResponse.json(
      { error: 'root must be an absolute path to an existing Harness repository.' },
      { status: 400 },
    );
  }

  let repository: FileHarnessRepository | undefined;
  try {
    repository = FileHarnessRepository.open(body.root, { mode: 'readonly' });
    // Validate a complete generation before persisting the selection.
    projectCanonicalRepository({
      repository,
      runtimeId: 'codepilot_runtime',
    });
    setSetting(HARNESS_HOME_ROOT_SETTING, repository.root);
    const manifest = repository.manifest;
    return NextResponse.json({
      success: true,
      root: repository.root,
      generation: manifest.generation,
      inventory: {
        creativeMethods: manifest.definition.creativeMethodRefs.filter(
          (ref) => ref.mediaType === CREATIVE_METHOD_MEDIA_TYPE,
        ).length,
        tasteMemories: manifest.state.preferenceRefs.filter(
          (ref) => ref.mediaType === TASTE_MEMORY_MEDIA_TYPE,
        ).length,
        creativeProjects: manifest.state.feedbackRefs.filter(
          (ref) => ref.mediaType === CREATIVE_PROJECT_MEDIA_TYPE,
        ).length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 409 },
    );
  } finally {
    repository?.close();
  }
}

export async function DELETE() {
  const previousRoot = getSetting(HARNESS_HOME_ROOT_SETTING) || undefined;
  setSetting(HARNESS_HOME_ROOT_SETTING, '');
  return NextResponse.json({
    success: true,
    previousRoot,
    repositoryDeleted: false,
  });
}
