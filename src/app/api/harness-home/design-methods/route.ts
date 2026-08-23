import { NextRequest, NextResponse } from 'next/server';
import { getSetting } from '@/lib/db';
import {
  HARNESS_HOME_ROOT_SETTING,
} from '@/lib/harness-home/runtime/configured';
import {
  listCreativeMethods,
  writeCreativeMethod,
  type WriteCreativeMethodInput,
} from '@/lib/harness-home/design-method';
import { FileHarnessRepository } from '@/lib/harness-home/repository';
import { assertEvidenceRefResolvable } from '@/lib/harness-home/evidence';

function configuredRoot(): string | null {
  return getSetting(HARNESS_HOME_ROOT_SETTING)?.trim() || null;
}

export async function GET() {
  const root = configuredRoot();
  if (!root) {
    return NextResponse.json({ configured: false, methods: [] });
  }
  let repository: FileHarnessRepository | undefined;
  try {
    repository = FileHarnessRepository.open(root, { mode: 'readonly' });
    const methods = listCreativeMethods(repository).map((record) => ({
      ...record.definition,
      definitionRef: record.definitionRef,
      guideRef: record.guideRef,
    }));
    return NextResponse.json({
      configured: true,
      root: repository.root,
      generation: repository.manifest.generation,
      methods,
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
      { error: 'Configure a Harness Home root before writing a Design Method.' },
      { status: 409 },
    );
  }
  const body = await request.json().catch(() => null) as
    | WriteCreativeMethodInput
    | null;
  if (
    !body
    || typeof body.id !== 'string'
    || typeof body.version !== 'string'
    || typeof body.title !== 'string'
    || typeof body.summary !== 'string'
    || typeof body.sourceRef !== 'string'
    || !Array.isArray(body.steps)
    || !Array.isArray(body.triggers)
    || !Array.isArray(body.critiqueCriteria)
  ) {
    return NextResponse.json(
      {
        error:
          'id, version, title, summary, sourceRef, triggers, steps and '
          + 'critiqueCriteria are required.',
      },
      { status: 400 },
    );
  }
  let repository: FileHarnessRepository | undefined;
  try {
    repository = FileHarnessRepository.open(root, { mode: 'require-writable' });
    for (const [label, refs] of [
      ['Design Method reference', body.referenceRefs],
      ['Design Method counterexample', body.counterexampleRefs],
    ] as const) {
      for (const ref of refs) {
        assertEvidenceRefResolvable(repository, ref, label);
      }
    }
    if (body.confirmationEvidenceRef) {
      assertEvidenceRefResolvable(
        repository,
        body.confirmationEvidenceRef,
        'Design Method confirmation',
      );
    }
    const result = writeCreativeMethod(repository, body);
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
