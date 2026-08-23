'use client';

import { useEffect } from 'react';
import { showToast, type ToastType } from '@/hooks/useToast';

const POLL_INTERVAL = 5_000;
const PRIORITY_TO_TOAST: Record<string, ToastType> = {
  low: 'info',
  normal: 'info',
  urgent: 'warning',
};

interface ClaimedToast {
  delivery_id: string;
  event_id: string;
  title: string;
  body: string;
  priority: 'low' | 'normal' | 'urgent';
}

export function useNotificationPoll() {
  useEffect(() => {
    let stopped = false;
    // Side-effect identity belongs to the effect lifecycle, not render. React
    // Strict Mode may mount the effect twice; each lease owner is independent
    // and stale claims remain recoverable by the DB timeout contract.
    const owner = `renderer-${crypto.randomUUID()}`;

    async function settle(delivery: ClaimedToast, outcome: 'delivered' | 'error', error?: string) {
      await fetch('/api/tasks/notify/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          delivery_id: delivery.delivery_id,
          owner,
          channel: 'renderer-toast',
          outcome,
          error,
        }),
      });
    }

    async function poll() {
      try {
        // Bound each tick so a long offline backlog cannot monopolize render.
        for (let i = 0; i < 10 && !stopped; i += 1) {
          const res = await fetch('/api/tasks/notify/claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel: 'renderer-toast', owner }),
          });
          if (!res.ok) return;
          const data = await res.json() as { delivery: ClaimedToast | null };
          if (!data.delivery) return;
          try {
            showToast({
              type: PRIORITY_TO_TOAST[data.delivery.priority] || 'info',
              message: data.delivery.body
                ? `${data.delivery.title}: ${data.delivery.body}`
                : data.delivery.title,
            });
            await settle(data.delivery, 'delivered');
          } catch (error) {
            await settle(
              data.delivery,
              'error',
              error instanceof Error ? error.message : String(error),
            );
          }
        }
      } catch {
        // Durable rows remain queued and will be retried on a later tick.
      }
    }

    void poll();
    const timer = setInterval(() => { void poll(); }, POLL_INTERVAL);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
}
