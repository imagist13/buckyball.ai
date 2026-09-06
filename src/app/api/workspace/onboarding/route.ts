import { NextRequest, NextResponse } from 'next/server';
import { processOnboarding } from '@/lib/onboarding-processor';

const QUESTIONS = [
  'assistant.onboardingQ1',
  'assistant.onboardingQ2',
  'assistant.onboardingQ3',
  'assistant.onboardingQ4',
  'assistant.onboardingQ5',
  'assistant.onboardingQ6',
  'assistant.onboardingQ7',
  'assistant.onboardingQ8',
  'assistant.onboardingQ9',
  'assistant.onboardingQ10',
  'assistant.onboardingQ11',
  'assistant.onboardingQ12',
  'assistant.onboardingQ13',
];

const QUESTION_LABELS = [
  'How should I address you?',
  'What name should I use for myself?',
  'Do you prefer "concise and direct" or "detailed explanations"?',
  'Do you prefer "minimal interruptions" or "proactive suggestions"?',
  'What are your three hard boundaries?',
  'What are your three most important current goals?',
  'Do you prefer output as "lists", "reports", or "conversation summaries"?',
  'What information may be written to long-term memory?',
  'What information must never be written to long-term memory?',
  'What three things should I do first when entering a project?',
  'How do you organize your materials? (by project / time / topic / mixed)',
  'Where should new information go by default?',
  'How should completed tasks be archived?',
];

export async function GET() {
  return NextResponse.json({
    questions: QUESTIONS.map((key, i) => ({
      key,
      label: QUESTION_LABELS[i],
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

    await processOnboarding(answers, sessionId);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[workspace/onboarding] POST failed:', e);
    const message = e instanceof Error ? e.message : 'Onboarding failed';
    const status = message.includes('No workspace path') ? 400
      : message.includes('does not belong') ? 403
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
