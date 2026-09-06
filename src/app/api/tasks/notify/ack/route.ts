import { NextRequest, NextResponse } from 'next/server';
import { settleClaimedNotificationDelivery } from '@/lib/db';
import { validateNotificationConsumerRequest } from '@/lib/notification-claim-policy';

/** Settle one leased delivery attempt. Owner matching prevents stale acks. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { delivery_id, owner, channel, outcome, error, retryable } = body as {
      delivery_id?: string;
      owner?: string;
      channel?: string;
      outcome?: string;
      error?: string;
      retryable?: boolean;
    };

    const policy = validateNotificationConsumerRequest(request, channel);
    if (!policy.ok) return NextResponse.json({ error: policy.error }, { status: policy.status });

    if (!delivery_id || !owner || !channel || !outcome) {
      return NextResponse.json(
        { error: 'delivery_id, owner, channel and outcome are required' },
        { status: 400 },
      );
    }
    if (
      typeof delivery_id !== 'string' || delivery_id.length > 128
      || typeof owner !== 'string' || owner.length > 128
      || (error !== undefined && (typeof error !== 'string' || error.length > 2_000))
    ) {
      return NextResponse.json({ error: 'Ack fields exceed their allowed bounds' }, { status: 400 });
    }

    if (outcome !== 'delivered' && outcome !== 'error') {
      return NextResponse.json(
        { error: 'outcome must be delivered or error' },
        { status: 400 },
      );
    }

    const result = settleClaimedNotificationDelivery({
      deliveryId: delivery_id,
      owner,
      outcome,
      error,
      retryable: retryable === true,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const invalidJson = e instanceof SyntaxError;
    return NextResponse.json(
      { error: invalidJson ? 'Invalid JSON.' : (e instanceof Error ? e.message : 'Failed') },
      { status: invalidJson ? 400 : 500 },
    );
  }
}
