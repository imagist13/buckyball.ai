import { NextResponse } from 'next/server';
import { getSetting } from '@/lib/db';
import { generateDirectoryDocs, generateRootDocs } from '@/lib/assistant-workspace';

export async function POST() {
  try {
    const workspacePath = getSetting('assistant_workspace_path');
    if (!workspacePath) {
      return NextResponse.json(
        { error: 'No assistant workspace path configured' },
        { status: 400 },
      );
    }

    const rootFiles = generateRootDocs(workspacePath);
    const directoryFiles = generateDirectoryDocs(workspacePath);
    return NextResponse.json({ root: rootFiles, directory: directoryFiles, files: [...rootFiles, ...directoryFiles] });
  } catch (e) {
    console.error('[workspace/docs] Failed to generate docs:', e);
    return NextResponse.json(
      { error: 'Failed to generate docs' },
      { status: 500 },
    );
  }
}
