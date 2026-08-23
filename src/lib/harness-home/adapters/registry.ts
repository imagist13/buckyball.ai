import { DescriptorRegistry } from '../registry';
import { assistantWorkspaceHarnessAdapter } from './assistant-workspace';
import { claudeCodeHarnessAdapter } from './claude-code';
import { codexHarnessAdapter } from './codex';
import type { HarnessAdapter } from './types';

const descriptors = new DescriptorRegistry([
  assistantWorkspaceHarnessAdapter.descriptor,
  claudeCodeHarnessAdapter.descriptor,
  codexHarnessAdapter.descriptor,
]);
descriptors.seal();

const adapters = new Map<string, HarnessAdapter>([
  [assistantWorkspaceHarnessAdapter.descriptor.id, assistantWorkspaceHarnessAdapter],
  [claudeCodeHarnessAdapter.descriptor.id, claudeCodeHarnessAdapter],
  [codexHarnessAdapter.descriptor.id, codexHarnessAdapter],
]);

export function getHarnessAdapter(id: string): HarnessAdapter | undefined {
  return adapters.get(id);
}

export function requireHarnessAdapter(id: string): HarnessAdapter {
  const adapter = getHarnessAdapter(id);
  if (!adapter) throw new Error(`Harness adapter "${id}" is not registered.`);
  return adapter;
}

export function listHarnessAdapters(): readonly HarnessAdapter[] {
  return Array.from(adapters.values());
}

export function listHarnessAdapterDescriptors() {
  return descriptors.list();
}
