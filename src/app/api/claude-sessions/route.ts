import { listClaudeSessions } from '@/lib/claude-session-parser';
import { serverErrorResponse } from '@/lib/api-error';

export async function GET() {
  try {
    const sessions = listClaudeSessions();
    return Response.json({ sessions });
  } catch (error) {
    return serverErrorResponse('GET /api/claude-sessions', error);
  }
}
