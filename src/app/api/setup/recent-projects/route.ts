import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import fs from 'fs';

export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare(
      `SELECT DISTINCT working_directory FROM chat_sessions
       WHERE working_directory IS NOT NULL AND working_directory != ''
       ORDER BY updated_at DESC LIMIT 10`
    ).all() as { working_directory: string }[];

    // Filter to only existing directories
    const projects: string[] = [];
    for (const row of rows) {
      try {
        const stat = fs.statSync(row.working_directory);
        if (stat.isDirectory()) {
          projects.push(row.working_directory);
        }
      } catch {
        // Skip non-existent directories
      }
    }

    return NextResponse.json({ projects });
  } catch {
    return NextResponse.json({ projects: [] });
  }
}
