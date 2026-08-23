import { NextResponse } from 'next/server';
import { CLI_TOOLS_CATALOG } from '@/lib/cli-tools-catalog';

export async function GET() {
  return NextResponse.json({ tools: CLI_TOOLS_CATALOG });
}
