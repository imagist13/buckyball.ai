import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import {
  classifyDatabaseStartupCode,
  DATABASE_STARTUP_MARKER,
  DatabaseStartupError,
  formatServerHealthDiagnostic,
} from '@/lib/database-recovery';

const SERVER_HEALTH_MARKER = 'CODEPILOT_SERVER_HEALTH_FAILED';

export async function GET() {
  try {
    getDb().prepare('SELECT 1 AS healthy').get();
    return NextResponse.json({
      status: 'ok',
      database: 'healthy',
      nodeModuleVersion: process.versions.modules,
    });
  } catch (error) {
    if (error instanceof DatabaseStartupError) {
      // Deliberately path-free: Electron Main recognizes the marker and shows
      // its offline recovery surface without sending the raw DB error onward.
      console.error(error.message);
      return NextResponse.json({
        status: 'blocked',
        marker: DATABASE_STARTUP_MARKER,
        code: error.code,
        preservation: error.preservation,
      }, { status: 503 });
    }
    if (classifyDatabaseStartupCode(error) === 'database_busy') {
      const transient = new DatabaseStartupError('database_busy', 'not_attempted');
      console.warn(transient.message);
      return NextResponse.json({
        status: 'blocked',
        marker: DATABASE_STARTUP_MARKER,
        code: transient.code,
        preservation: transient.preservation,
      }, { status: 503 });
    }
    // Unknown route/runtime failures are product faults, not proof of DB
    // corruption. Never route them to the destructive database recovery UI.
    console.error(formatServerHealthDiagnostic(error));
    return NextResponse.json({
      status: 'error',
      marker: SERVER_HEALTH_MARKER,
    }, { status: 503 });
  }
}
