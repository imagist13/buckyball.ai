import { NextRequest } from 'next/server';
import { getMessages, getSession, getTaskRunSummariesByIds } from '@/lib/db';
import type { MessagesResponse, TaskRunSummary } from '@/types';

/** Strip base64 `data` fields from <!--files:...--> HTML comments in message content */
function stripFileData(content: string): string {
  const match = content.match(/^<!--files:(.*?)-->/);
  if (!match) return content;
  try {
    const files = JSON.parse(match[1]);
    const cleaned = files.map((f: Record<string, unknown>) => {
      const { data, ...rest } = f;
      return rest;
    });
    return `<!--files:${JSON.stringify(cleaned)}-->${content.slice(match[0].length)}`;
  } catch {
    return content;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getSession(id);
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    const searchParams = request.nextUrl.searchParams;
    const limitParam = searchParams.get('limit');
    const beforeParam = searchParams.get('before');

    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 30, 1), 500) : 30;
    const beforeRowId = beforeParam ? parseInt(beforeParam, 10) || undefined : undefined;

    const { messages, hasMore } = getMessages(id, { limit, beforeRowId, excludeHeartbeatAck: true });
    // Sanitize: strip base64 data from file attachments in old messages
    const sanitizedMessages = messages.map(m => ({
      ...m,
      content: stripFileData(m.content),
    }));

    // Phase 3 Step 4 — inline-join task_run_logs for messages whose
    // `task_run_id` is non-null. Lets MessageList render
    // `<TaskRunMarker />` without N+1 fetches per marker. Empty when
    // no message in this page came from a scheduled task / heartbeat.
    // task_run_id is NEVER appended to message.content, so prompt
    // builders constructing LLM context naturally ignore it.
    const runIds = Array.from(
      new Set(
        sanitizedMessages
          .map((m) => m.task_run_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    );
    const taskRuns: Record<string, TaskRunSummary> = runIds.length > 0
      ? getTaskRunSummariesByIds(runIds)
      : {};

    const response: MessagesResponse = { messages: sanitizedMessages, hasMore, taskRuns };
    return Response.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch messages';
    return Response.json({ error: message }, { status: 500 });
  }
}
