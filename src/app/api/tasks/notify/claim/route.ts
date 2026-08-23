import { NextRequest, NextResponse } from 'next/server';
import { claimNotificationDelivery } from '@/lib/db';
import { validateNotificationConsumerRequest } from '@/lib/notification-claim-policy';

export async function POST(request: NextRequest) {
  let body: { channel?: string; owner?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }
  const policy = validateNotificationConsumerRequest(request, body.channel);
  if (!policy.ok) return NextResponse.json({ error: policy.error }, { status: policy.status });
  if (!body.owner || typeof body.owner !== 'string' || body.owner.length > 128) {
    return NextResponse.json({ error: 'A bounded owner is required.' }, { status: 400 });
  }

  const delivery = claimNotificationDelivery({ channel: body.channel!, owner: body.owner });
  return NextResponse.json({ delivery });
}
