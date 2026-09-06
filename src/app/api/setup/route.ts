import { NextRequest, NextResponse } from 'next/server';
import { getSetting, setSetting } from '@/lib/db';
import { findClaudeBinary } from '@/lib/platform';
import { hasCodePilotProvider } from '@/lib/provider-presence';

export async function GET() {
  try {
    // Check if setup was already completed
    const completedRaw = getSetting('setup_completed');
    let completed = completedRaw === 'true';

    // Claude status
    let claude: 'not-configured' | 'completed' | 'skipped' | 'needs-fix' = 'not-configured';
    const claudeSkipped = getSetting('setup_claude_skipped');
    if (claudeSkipped === 'true') {
      claude = 'skipped';
    } else {
      try {
        const binary = findClaudeBinary();
        claude = binary ? 'completed' : 'not-configured';
      } catch {
        claude = 'not-configured';
      }
    }

    // Provider status — MUST stay in lockstep with /api/chat's precheck
    // (hasCodePilotProvider). If SetupCenter tells a user "provider: completed"
    // while the chat entry is 412-blocking them, the wizard is lying.
    //
    // Specifically: Claude CLI existence is NOT a provider source for CodePilot —
    // it's the Claude card's concern. A user who only has the CLI installed
    // (no DB provider, no env, no OAuth) falls into "not-configured" here so
    // the Provider card can surface the "Add provider" CTA.
    let provider: 'not-configured' | 'completed' | 'skipped' | 'needs-fix' = 'not-configured';
    if (hasCodePilotProvider()) {
      provider = 'completed';
    } else {
      const providerSkipped = getSetting('setup_provider_skipped');
      provider = providerSkipped === 'true' ? 'skipped' : 'not-configured';
    }

    // Project status
    let project: 'not-configured' | 'completed' | 'skipped' | 'needs-fix' = 'not-configured';
    const projectSkipped = getSetting('setup_project_skipped');
    const defaultProject = getSetting('setup_default_project');
    if (projectSkipped === 'true') {
      project = 'skipped';
    } else if (defaultProject) {
      // Validate path exists
      const fs = await import('fs');
      try {
        const stat = fs.statSync(defaultProject);
        project = stat.isDirectory() ? 'completed' : 'needs-fix';
      } catch {
        project = 'needs-fix';
      }
    }

    // Normalize stale per-card state: if every card is already completed or
    // skipped but the top-level setup_completed flag never got written, write
    // it now. Fixes users whose three cards landed at 3/3 without ever
    // triggering the frontend auto-close path (e.g. initial GET returned 3/3,
    // so SetupCenter's `initialCompletedCount < 3` gate never fired).
    const allCardsDone =
      (claude === 'completed' || claude === 'skipped') &&
      (provider === 'completed' || provider === 'skipped') &&
      (project === 'completed' || project === 'skipped');
    if (allCardsDone && !completed) {
      setSetting('setup_completed', 'true');
      completed = true;
    }

    return NextResponse.json({
      completed,
      claude,
      provider,
      project,
      defaultProject: defaultProject || undefined,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to get setup state' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { card, status, value } = body;

    if (!card || !status) {
      return NextResponse.json({ error: 'Missing card or status' }, { status: 400 });
    }

    switch (card) {
      case 'claude':
        if (status === 'skipped') setSetting('setup_claude_skipped', 'true');
        else if (status === 'completed') setSetting('setup_claude_skipped', '');
        break;
      case 'provider':
        if (status === 'skipped') setSetting('setup_provider_skipped', 'true');
        else if (status === 'completed') setSetting('setup_provider_skipped', '');
        break;
      case 'project':
        if (status === 'skipped') {
          setSetting('setup_project_skipped', 'true');
        } else if (status === 'completed' && value) {
          setSetting('setup_default_project', value);
          setSetting('setup_project_skipped', '');
        }
        break;
      case 'completed':
        setSetting('setup_completed', 'true');
        break;
      default:
        return NextResponse.json({ error: 'Unknown card' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to update setup state' }, { status: 500 });
  }
}
