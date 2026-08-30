/**
 * Effort-menu level resolution — the single source for "which tiers may the
 * composer's effort selector offer?".
 *
 * Phase 0 (2026-07-17). This used to live inline in EffortSelectorDropdown as
 *   supportedEffortLevels || ['low', 'medium', 'high', 'xhigh', 'max']
 * i.e. whenever capability discovery produced NOTHING, the menu invented the
 * full five-tier ladder. Every tier in it was a claim with no source: users
 * picked `xhigh` for models that never supported it, and the request either
 * silently downgraded or dropped the value. The fallback WAS the fake-tier
 * bug — there is no honest default here, so absence now means hide.
 *
 * Contract: only a real, non-empty capability list yields a menu. Missing,
 * empty, or junk-only input → null → the caller renders nothing.
 *
 * Extracted as a pure function so the rule is unit-testable directly rather
 * than through a hand-copied replica of the component's logic.
 */

/**
 * `auto` = "send no explicit effort", letting the runtime apply its per-model
 * default. It is CodePilot's own option, not a vendor tier, and is always
 * offered first when a menu is shown at all.
 */
export const EFFORT_AUTO = 'auto' as const;

/**
 * Translate the composer's selection into the wire value.
 *
 * `auto` is CodePilot's own option, so it must NEVER reach a provider: it
 * means "omit effort and let the model's own default apply". Phase 1
 * (2026-07-17) pulled this out of two inline copies (ChatView / new-chat
 * page) that each re-spelled `x && x !== 'auto' ? x : undefined` — with Kimi
 * for Coding the menu is Auto+Max and nothing else, so a third call site
 * getting this subtly wrong would send `effort=auto` to a channel whose only
 * legal value is `max`.
 *
 * @returns the level to send, or undefined to omit the parameter entirely.
 */
export function toWireEffort(selectedEffort: string | undefined | null): string | undefined {
  if (typeof selectedEffort !== 'string') return undefined;
  const effort = selectedEffort.trim();
  if (!effort || effort === EFFORT_AUTO) return undefined;
  return effort;
}

/**
 * Resolve the levels the effort menu should render.
 *
 * @param supportedEffortLevels tiers the current model really declares
 *   (capability discovery / catalog with provenance).
 * @returns `['auto', ...levels]`, or null when there is no sourced capability
 *   info — caller MUST hide the selector rather than guess.
 */
export function resolveEffortMenuLevels(
  supportedEffortLevels: readonly (string | undefined | null)[] | undefined | null,
): string[] | null {
  if (!Array.isArray(supportedEffortLevels)) return null;

  const seen = new Set<string>();
  const levels: string[] = [];
  for (const raw of supportedEffortLevels) {
    // Defensive: upstream schema drift has already produced [undefined, ...]
    // once (codex model/list `effort` → `reasoningEffort`). A hole in the list
    // must drop that entry, not render an `undefined` row.
    if (typeof raw !== 'string') continue;
    const level = raw.trim();
    if (!level || level === EFFORT_AUTO || seen.has(level)) continue;
    seen.add(level);
    levels.push(level);
  }

  if (levels.length === 0) return null;
  return [EFFORT_AUTO, ...levels];
}

/**
 * Resolve the tier the composer's effort button should DISPLAY (model plan
 * Phase 2 / s07, reviewer fix run i31, 2026-07-18).
 *
 * MessageInput historically read `effortProp ?? localEffort`, mixing a
 * parent-owned controlled value with an internal fallback. That dual-mode was
 * the s07 bug: when the parent reset its effort to `undefined` (a model switch
 * dropped an unsupported tier), the stale `localEffort` re-surfaced, so the
 * button kept showing e.g. `xhigh` while the parent's send state was already
 * `undefined` and `toWireEffort` omitted the parameter — the button lied about
 * what actually reached the wire.
 *
 * When the parent owns the value (`isControlled`, i.e. `onEffortChange` is
 * wired — every real call site does), the display is EXACTLY the controlled
 * value, with `undefined`/empty meaning Auto. The local value is never
 * consulted, so a parent reset is observable as Auto. `localEffort` is honored
 * only for uncontrolled standalone usage (no `onEffortChange`), where there is
 * no parent to own the state.
 *
 * @returns the tier label to render (`'auto'` when nothing explicit is set).
 */
export function resolveComposerEffortDisplay(
  controlledEffort: string | undefined | null,
  localEffort: string,
  isControlled: boolean,
): string {
  if (isControlled) {
    return typeof controlledEffort === 'string' && controlledEffort.length > 0
      ? controlledEffort
      : EFFORT_AUTO;
  }
  return localEffort;
}

/**
 * Decide what the composer's effort selection should become after the user
 * switches to a different model (model plan Phase 2 / s07, 2026-07-18).
 *
 * When the currently-selected tier isn't offered by the new model — e.g. the
 * user had `xhigh` on Opus 4.7 and switches to Sonnet 4.6 (which only ships
 * low/medium/high/max) — silently keeping `xhigh` would send a tier the model
 * rejects, or the send path would drop it, so the button would lie. Falling
 * back to `auto` (send no explicit effort, let the model default apply) is the
 * honest recovery. `auto` is always valid whenever a menu shows at all, so it
 * never itself triggers a reset.
 *
 * Switching INTO Sonnet 5 (low/medium/high/xhigh/max) from Opus keeps `xhigh`
 * valid → no reset, no toast.
 *
 * @param currentEffort the composer's current selection (may be undefined /
 *   'auto' / a concrete tier).
 * @param newSupportedLevels the tiers the NEW model declares (catalog /
 *   discovery). Missing/empty ⇒ the new model has no sourced effort menu, so
 *   any concrete prior pick can't survive → reset.
 * @returns `{ effort, didReset }`. `effort` is the value the caller should
 *   apply (undefined = Auto). `didReset` is true only when a concrete prior
 *   pick was actually dropped, so the caller can show a one-shot notice.
 */
export function resolveEffortAfterModelSwitch(
  currentEffort: string | undefined | null,
  newSupportedLevels: readonly (string | undefined | null)[] | undefined | null,
): { effort: string | undefined; didReset: boolean } {
  // Auto / unset is already the neutral choice — nothing to reset.
  const wire = toWireEffort(currentEffort ?? undefined);
  if (wire === undefined) return { effort: undefined, didReset: false };

  const menu = resolveEffortMenuLevels(newSupportedLevels);
  // `menu` includes the leading EFFORT_AUTO sentinel; membership of a concrete
  // tier is a genuine "the new model supports it" check.
  if (menu && menu.includes(wire)) {
    return { effort: wire, didReset: false };
  }
  return { effort: undefined, didReset: true };
}

/**
 * The composer's full effort effect for a model switch — clear an illegal
 * transient tier and (in lockstep) notice it (model plan Phase 2 / s07,
 * 2026-07-18; reviewer fix run i31, 2026-07-18).
 *
 * The effort effect is INDEPENDENT of whether the switch was manual or an
 * auto-correct. Both kinds of switch change the *effective model*, and once the
 * model changes, a still-selected tier the new model doesn't offer is a lie
 * whichever way we got here: the provider would reject it, or `toWireEffort`
 * would silently drop it on send, so the composer button would claim a tier that
 * never reaches the wire. Clearing the illegal transient effort must therefore
 * happen on EVERY effective model change.
 *
 * The earlier design suppressed the reset on auto-correct to keep an un-asked
 * switch "invisible", but that traded one misleading state (a surprise reset)
 * for a worse one (a button that shows and sends an unsupported tier). The
 * reviewer's ruling (i31): the two concerns are separate — NOT persisting the
 * auto-fallback's session pin stays the caller's job (it early-returns on
 * `isAuto` before writing the DB / localStorage), but clearing the current
 * illegal effort is not optional and does not depend on `isAuto`.
 *
 * `resetEffort` and `showResetToast` are always equal — there is never a toast
 * without a reset, nor a reset without a toast; the notice is sourced and fires
 * exactly once because after the reset the selection is Auto, which never resets
 * again. They are separate fields only so the caller can read intent at each
 * call site.
 *
 * @returns the effect the caller should apply: whether to
 *   `setSelectedEffort(undefined)` and whether to show the reset toast.
 */
export function resolveModelSwitchEffortEffect(
  currentEffort: string | undefined | null,
  newSupportedLevels: readonly (string | undefined | null)[] | undefined | null,
): { resetEffort: boolean; showResetToast: boolean } {
  const { didReset } = resolveEffortAfterModelSwitch(currentEffort, newSupportedLevels);
  return { resetEffort: didReset, showResetToast: didReset };
}
