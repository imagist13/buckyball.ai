// Server component that derives the capability matrix per Runtime and
// passes one matrix per Runtime to the panel (each rendered as a card).
//
// Codex card (decision 2026-05-28): always derived from the **Codex
// Account** native profile — Memory/Widget/Tasks callable with notes,
// image/media/dashboard/cli honestly "not callable" (native injection is
// the open decision point). Earlier this keyed off the effective default
// provider, which rendered the provider-proxy profile when the default
// wasn't Codex Account and overstated image/media as callable even though
// they aren't under Codex Account. claude_code / codepilot_runtime
// matrices are provider-agnostic.
//
// Server-side derivation isolates the capability-contract → MCP-factory
// → `child_process` dep chain to the server bundle; the browser bundle
// only receives the rendered cell data.

import { RuntimePanel } from "@/components/settings/RuntimePanel";
import {
  buildCapabilityMatrix,
  capabilityMatrixForRuntimeProvider,
} from "@/lib/harness/capability-matrix";

export default function SettingsRuntimePage() {
  // The Codex capability card always reflects the **Codex Account** native
  // profile: Memory / Widget / Tasks callable (with notes), and image /
  // media / dashboard / cli honestly "not callable" (native injection is
  // the open decision point). Per user decision (2026-05-28) — aligning the
  // card to how Codex Account actually behaves. Deriving from the effective
  // default provider instead made the card render the provider-proxy
  // profile when the default wasn't Codex Account, which overstated image /
  // media as callable even though they aren't under Codex Account. The
  // claude_code / codepilot_runtime matrices are provider-agnostic.
  const matrix = buildCapabilityMatrix();
  const codexCells = capabilityMatrixForRuntimeProvider(
    "codex_runtime",
    "codex_account",
  );

  return (
    <RuntimePanel
      capabilityCells={{
        claude_code: matrix.claude_code,
        codepilot_runtime: matrix.codepilot_runtime,
        codex_runtime: codexCells,
      }}
    />
  );
}
