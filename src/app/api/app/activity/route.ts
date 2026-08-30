import * as bridgeManager from '@/lib/bridge/bridge-manager';
import { hasActiveSessionWork, listScheduledTasks } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const bridgeStatus = bridgeManager.getStatus();
  const taskRunning = listScheduledTasks().some((task) => task.last_status === 'running');
  return Response.json({
    // The API runs in Electron's utility process; renderer globalThis state is
    // neither import-safe nor shared across processes. The durable fact is the
    // intersection of active runtime_status and a non-expired runtime owner;
    // status residue after a crashed owner must not block installation forever.
    chat: hasActiveSessionWork(),
    bridge: bridgeStatus.running,
    task: taskRunning,
  });
}
