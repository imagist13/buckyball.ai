import { NextRequest } from 'next/server';
import { getSession } from '@/lib/db';
import { buildSubagentRunDetails } from '@/lib/subagent-run-context';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!getSession(id)) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }
    const logicalRunId = request.nextUrl.searchParams.get('logical_run_id')?.trim();
    if (!logicalRunId) {
      return Response.json({ error: 'logical_run_id is required' }, { status: 400 });
    }
    const rawAfterCursor = request.nextUrl.searchParams.get('after_cursor');
    const parsedAfterCursor = rawAfterCursor === null ? 0 : Number(rawAfterCursor);
    if (
      rawAfterCursor !== null
      && (!Number.isSafeInteger(parsedAfterCursor) || parsedAfterCursor < 0)
    ) {
      return Response.json({ error: 'after_cursor must be a non-negative integer' }, { status: 400 });
    }
    const details = buildSubagentRunDetails(id, logicalRunId, {
      afterEventCursor: parsedAfterCursor,
    });
    if (!details) {
      return Response.json({ error: 'Sub-agent run not found' }, { status: 404 });
    }
    return Response.json(details);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read Sub-agent run';
    return Response.json({ error: message }, { status: 500 });
  }
}
