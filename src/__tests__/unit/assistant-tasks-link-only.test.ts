/**
 * v9 → v12 retirement contract for `Settings → Assistant`'s scheduled-task
 * surface.
 *
 * Phase 3 IA evolution:
 *   - v6: inline task list + delete button moved into a dedicated
 *     `/settings/tasks` page (TasksSection); Assistant page kept the
 *     inline list as a transitional view.
 *   - v9: inline list + delete button retired from Assistant page;
 *     replaced with a single SettingsCard linking to
 *     `/settings/tasks?source=assistant` ("X scheduled tasks → view
 *     in Settings · Tasks").
 *   - v12: even the link card retired. Reasoning: the global Tasks
 *     entry is already reachable from the Settings sidebar nav, and a
 *     redundant Assistant-page entry added IA noise without surfacing
 *     assistant-specific information. The Assistant page now has NO
 *     scheduled-task surface at all.
 *
 * This file pins the v12 end-state: the Assistant component must not
 * render any scheduled-task block (inline OR link), must not iterate
 * `tasks.map`, must not own a delete handler, and must not import
 * `Trash` or `ScheduledTask`. The retired i18n keys must be gone from
 * both bundles. The file kept its v9 name for git-history traceability;
 * the description here records the full retirement chain.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = readFileSync(
  path.resolve(__dirname, '../../components/settings/AssistantWorkspaceSection.tsx'),
  'utf-8',
);

const ZH_SRC = readFileSync(
  path.resolve(__dirname, '../../i18n/zh.ts'),
  'utf-8',
);
const EN_SRC = readFileSync(
  path.resolve(__dirname, '../../i18n/en.ts'),
  'utf-8',
);

/**
 * Strip line + block comments so retirement rationale we leave in the
 * source ("v12 — Scheduled tasks block removed entirely…") doesn't
 * trip the negative assertions below. Order = lines first, then
 * blocks, sharing the gotcha protection used by other repo-wide grep
 * tests (a `/*` inside a line comment must be removed before the
 * block-comment pass eats it).
 */
function stripComments(src: string): string {
  return src
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

const SRC_NO_COMMENTS = stripComments(SRC);
const ZH_NO_COMMENTS = stripComments(ZH_SRC);
const EN_NO_COMMENTS = stripComments(EN_SRC);

describe('Settings → Assistant must NOT render any scheduled-task surface (v12 retirement)', () => {
  it('does not iterate `tasks.map(...)` to render rows (v9 invariant retained)', () => {
    assert.doesNotMatch(
      SRC_NO_COMMENTS,
      /\btasks\.map\s*\(/,
      'AssistantWorkspaceSection must not iterate `tasks.map(...)` — full list lives in /settings/tasks',
    );
  });

  it('does not declare a tasks state variable (the count fetch was retired in v12)', () => {
    // The pre-v12 link card needed `tasks.length` to show "N scheduled
    // tasks"; with the link card removed, fetching the list at all is
    // dead work. Pin both the state declaration and the call site.
    assert.doesNotMatch(
      SRC_NO_COMMENTS,
      /\buseState\s*<\s*ScheduledTask\[\]\s*>/,
      'AssistantWorkspaceSection must not declare `useState<ScheduledTask[]>(...)` — the v12 retirement removed the only consumer',
    );
    assert.doesNotMatch(
      SRC_NO_COMMENTS,
      /\bsetTasks\s*\(/,
      'AssistantWorkspaceSection must not call `setTasks(...)` — the tasks state is retired',
    );
  });

  it('does not import the ScheduledTask type (no consumer left in this file)', () => {
    assert.doesNotMatch(
      SRC_NO_COMMENTS,
      /\bScheduledTask\b/,
      'AssistantWorkspaceSection must not import or reference the ScheduledTask type — the v12 retirement removed the last consumer',
    );
  });

  it('does not contain a per-task delete handler (v9 invariant retained)', () => {
    assert.doesNotMatch(
      SRC_NO_COMMENTS,
      /\bhandleDeleteTask\b/,
      'handleDeleteTask must not be reintroduced in AssistantWorkspaceSection — task deletion is owned by Settings → Tasks',
    );
    assert.doesNotMatch(
      SRC_NO_COMMENTS,
      /fetch\([^)]*['"`]\/api\/tasks\/[^)]*method:\s*['"]DELETE['"]/,
      'AssistantWorkspaceSection must not issue DELETE /api/tasks/:id',
    );
  });

  it('does not import the Trash icon (v9 invariant retained)', () => {
    assert.doesNotMatch(
      SRC_NO_COMMENTS,
      /import[^;]*\bTrash\b[^;]*from\s*['"]@\/components\/ui\/icon['"]/,
      'AssistantWorkspaceSection must not import Trash — the only consumer (per-row delete glyph) was retired in v9',
    );
  });

  it('does not navigate to the global Tasks page from this component (v12 — even the link card is gone)', () => {
    // v9 added a `router.push('/settings/tasks?source=assistant')`
    // link card; v12 removed it. This assertion catches an accidental
    // re-introduction without forcing the test author to first
    // re-justify why the duplicate IA entry is back.
    assert.doesNotMatch(
      SRC_NO_COMMENTS,
      /router\.push\(\s*['"`]\/settings\/tasks(?:\?[^'"`]*)?['"`]\s*\)/,
      'AssistantWorkspaceSection must not router.push to /settings/tasks — v12 retired the link card. The global Tasks page is reachable via the Settings sidebar nav.',
    );
  });

  it('does not reference any of the retired tasks-link i18n keys', () => {
    for (const retired of [
      'assistant.scheduledTasks',
      'assistant.tasksLinkEmpty',
      'assistant.tasksLinkCount',
      'assistant.tasksLinkAction',
      'assistant.taskDelete',
      'assistant.taskNextRun',
      'assistant.noTasks',
    ]) {
      assert.doesNotMatch(
        SRC_NO_COMMENTS,
        new RegExp(`['"\`]${retired.replace('.', '\\.')}['"\`]`),
        `AssistantWorkspaceSection must not reference retired i18n key ${retired}`,
      );
    }
  });

  it('zh + en bundles no longer DEFINE any of the retired tasks-link keys', () => {
    const retiredKeys = [
      'assistant.scheduledTasks',
      'assistant.tasksLinkEmpty',
      'assistant.tasksLinkCount',
      'assistant.tasksLinkAction',
      'assistant.taskDelete',
      'assistant.taskNextRun',
      'assistant.noTasks',
    ];
    for (const retired of retiredKeys) {
      const re = new RegExp(`['"\`]${retired.replace('.', '\\.')}['"\`]\\s*:`);
      assert.doesNotMatch(
        ZH_NO_COMMENTS,
        re,
        `zh.ts must NOT redefine retired key ${retired} (v12 retirement)`,
      );
      assert.doesNotMatch(
        EN_NO_COMMENTS,
        re,
        `en.ts must NOT redefine retired key ${retired} (v12 retirement)`,
      );
    }
  });
});
