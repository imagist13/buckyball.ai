import { NextRequest } from 'next/server';
import { getSession } from '@/lib/db';
import {
  publicWorkspaceIdentity,
  resolveCanonicalWorkspaceIdentity,
} from '@/lib/workspace-identity';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId')?.trim();
  const requestedDirectory = request.nextUrl.searchParams.get('workingDirectory')?.trim();

  let workingDirectory = '';
  if (sessionId) {
    const session = getSession(sessionId);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    workingDirectory = session.working_directory || '';
  } else {
    // New Chat has no row yet. The renderer may provide its currently selected
    // project, but the server resolver still requires a real absolute directory
    // before producing an identity.
    workingDirectory = requestedDirectory || '';
  }

  if (!workingDirectory) {
    return Response.json({ error: 'Workspace is unavailable' }, { status: 400 });
  }

  try {
    return Response.json({
      identity: publicWorkspaceIdentity(
        resolveCanonicalWorkspaceIdentity(workingDirectory),
      ),
    });
  } catch {
    return Response.json({ error: 'Workspace identity could not be resolved' }, { status: 400 });
  }
}

/** Bounded migration helper. The renderer already owns these legacy key paths;
 * the response uses array indexes so the server never has to echo them. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { workingDirectories?: unknown };
    if (!Array.isArray(body.workingDirectories) || body.workingDirectories.length > 50) {
      return Response.json({ error: 'workingDirectories must contain at most 50 entries' }, { status: 400 });
    }
    const results = body.workingDirectories.map((value, index) => {
      if (typeof value !== 'string') return { index, identity: null };
      try {
        return {
          index,
          identity: publicWorkspaceIdentity(resolveCanonicalWorkspaceIdentity(value)),
        };
      } catch {
        return { index, identity: null };
      }
    });
    return Response.json({ results });
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }
}
