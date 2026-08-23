import { NextRequest, NextResponse } from 'next/server';
import { getSetting } from '@/lib/db';
import {
  HARNESS_HOME_ROOT_SETTING,
} from '@/lib/harness-home/runtime/configured';
import {
  writeCanonicalDefinition,
  type CanonicalDefinitionKind,
} from '@/lib/harness-home/runtime/definitions';
import { FileHarnessRepository } from '@/lib/harness-home/repository/file-repository';

function isDefinitionKind(value: unknown): value is CanonicalDefinitionKind {
  return value === 'skill' || value === 'mcp';
}

export async function GET() {
  const root = getSetting(HARNESS_HOME_ROOT_SETTING)?.trim();
  if (!root) {
    return NextResponse.json({
      configured: false,
      definitions: [],
    });
  }
  let repository: FileHarnessRepository | undefined;
  try {
    repository = FileHarnessRepository.open(root, { mode: 'readonly' });
    const manifest = repository.manifest;
    return NextResponse.json({
      configured: true,
      root: repository.root,
      generation: manifest.generation,
      definitions: [
        ...manifest.definition.skillRefs.map((ref) => ({
          kind: 'skill',
          id: ref.id,
          path: ref.path,
          contentHash: ref.contentHash,
          provenance: ref.provenance,
        })),
        ...manifest.definition.mcpRefs.map((ref) => ({
          kind: 'mcp',
          id: ref.id,
          path: ref.path,
          contentHash: ref.contentHash,
          provenance: ref.provenance,
        })),
      ],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 409 },
    );
  } finally {
    repository?.close();
  }
}

export async function POST(request: NextRequest) {
  const root = getSetting(HARNESS_HOME_ROOT_SETTING)?.trim();
  if (!root) {
    return NextResponse.json(
      { error: 'Configure a Harness Home root before creating definitions.' },
      { status: 409 },
    );
  }
  const body = await request.json().catch(() => null) as {
    kind?: unknown;
    id?: unknown;
    content?: unknown;
    expectedContentHash?: unknown;
  } | null;
  if (
    !body
    || !isDefinitionKind(body.kind)
    || typeof body.id !== 'string'
    || typeof body.content !== 'string'
    || (
      body.expectedContentHash !== undefined
      && typeof body.expectedContentHash !== 'string'
    )
  ) {
    return NextResponse.json(
      {
        error:
          'kind (skill|mcp), id and content are required; '
          + 'expectedContentHash is optional.',
      },
      { status: 400 },
    );
  }

  let repository: FileHarnessRepository | undefined;
  try {
    repository = FileHarnessRepository.open(root, {
      mode: 'require-writable',
    });
    const result = writeCanonicalDefinition(repository, {
      kind: body.kind,
      id: body.id,
      content: body.content,
      ...(body.expectedContentHash
        ? { expectedContentHash: body.expectedContentHash }
        : {}),
    });
    return NextResponse.json(result, {
      status: result.status === 'created' ? 201 : 200,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 409 },
    );
  } finally {
    repository?.close();
  }
}
