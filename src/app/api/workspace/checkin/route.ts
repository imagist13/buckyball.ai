import { NextRequest, NextResponse } from 'next/server';
import { processCheckin } from '@/lib/checkin-processor';

const CHECK_IN_QUESTIONS = [
  'assistant.checkInQ1',
  'assistant.checkInQ2',
  'assistant.checkInQ3',
];

const CHECK_IN_LABELS = [
  'What did you work on or accomplish today?',
  'Any changes to your current priorities or goals?',
  'Anything you\'d like me to remember going forward?',
];

export async function GET() {
  return NextResponse.json({
    questions: CHECK_IN_QUESTIONS.map((key, i) => ({
      key,
      label: CHECK_IN_LABELS[i],
      index: i + 1,
    })),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { answers, sessionId } = body as { answers: Record<string, string>; sessionId?: string };

    if (!answers || typeof answers !== 'object') {
      return NextResponse.json({ error: 'Invalid answers format' }, { status: 400 });
    }

    await processCheckin(answers, sessionId);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[workspace/checkin] POST failed:', e);
    const message = e instanceof Error ? e.message : 'Check-in failed';
    const status = message.includes('No workspace path') ? 400
      : message.includes('does not belong') ? 403
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
