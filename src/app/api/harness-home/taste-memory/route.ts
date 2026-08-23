import { NextRequest, NextResponse } from 'next/server';
import { getSetting } from '@/lib/db';
import {
  HARNESS_HOME_ROOT_SETTING,
} from '@/lib/harness-home/runtime/configured';
import {
  inspectTasteMemories,
  revokeTasteMemory,
  writeTasteMemory,
  type WriteTasteMemoryInput,
} from '@/lib/harness-home/taste-memory';
import { FileHarnessRepository } from '@/lib/harness-home/repository';
import { assertEvidenceRefResolvable } from '@/lib/harness-home/evidence';

function configuredRoot(): string | null {
  return getSetting(HARNESS_HOME_ROOT_SETTING)?.trim() || null;
}

export async function GET() {
  const root = configuredRoot();
  if (!root) {
    return NextResponse.json({
      configured: false,
      tasteMemories: [],
      invalidTasteMemories: [],
    });
  }
  let repository: FileHarnessRepository | undefined;
  try {
    repository = FileHarnessRepository.open(root, { mode: 'readonly' });
    const inspection = inspectTasteMemories(repository);
    return NextResponse.json({
      configured: true,
      root: repository.root,
      generation: repository.manifest.generation,
      tasteMemories: inspection.records.map((record) => ({
        ...record.evidence,
        contentHash: record.ref.contentHash,
        path: record.ref.path,
      })),
      invalidTasteMemories: inspection.invalid,
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
  const root = configuredRoot();
  if (!root) {
    return NextResponse.json(
      { error: 'Configure a Harness Home root before writing Taste Memory.' },
      { status: 409 },
    );
  }
  const body = await request.json().catch(() => null) as
    | WriteTasteMemoryInput
    | null;
  if (
    !body
    || typeof body.id !== 'string'
    || typeof body.preferenceKey !== 'string'
    || typeof body.statement !== 'string'
    || typeof body.sourceRef !== 'string'
    || typeof body.confidence !== 'number'
    || !body.evidenceRef
  ) {
    return NextResponse.json(
      {
        error:
          'id, preferenceKey, statement, sourceRef, confidence and '
          + 'evidenceRef are required.',
      },
      { status: 400 },
    );
  }
  let repository: FileHarnessRepository | undefined;
  try {
    repository = FileHarnessRepository.open(root, { mode: 'require-writable' });
    assertEvidenceRefResolvable(
      repository,
      body.evidenceRef,
      'Taste Memory evidence',
    );
    const result = writeTasteMemory(repository, body);
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

export async function DELETE(request: NextRequest) {
  const root = configuredRoot();
  if (!root) {
    return NextResponse.json(
      { error: 'Configure a Harness Home root before revoking Taste Memory.' },
      { status: 409 },
    );
  }
  const body = await request.json().catch(() => null) as {
    id?: unknown;
    reason?: unknown;
    expectedContentHash?: unknown;
  } | null;
  if (
    !body
    || typeof body.id !== 'string'
    || typeof body.reason !== 'string'
    || typeof body.expectedContentHash !== 'string'
  ) {
    return NextResponse.json(
      { error: 'id, reason and expectedContentHash are required.' },
      { status: 400 },
    );
  }
  let repository: FileHarnessRepository | undefined;
  try {
    repository = FileHarnessRepository.open(root, { mode: 'require-writable' });
    return NextResponse.json(revokeTasteMemory(repository, {
      id: body.id,
      reason: body.reason,
      expectedContentHash: body.expectedContentHash,
    }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 409 },
    );
  } finally {
    repository?.close();
  }
}
