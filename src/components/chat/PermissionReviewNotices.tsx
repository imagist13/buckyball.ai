'use client';

import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { BuckyballIcon } from '@/components/ui/semantic-icon';
import { isDenyingState, type PermissionReviewNotice } from '@/lib/permission/review-event';

interface PermissionReviewNoticesProps {
  notices: PermissionReviewNotice[];
}

/**
 * Decisions made FOR the user â?today, the auto_review classifier denying a
 * tool (`runtime-permission-modes.md` Phase 1, a08).
 *
 * Why this exists as its own surface: `PermissionPrompt` renders questions the
 * user is asked. These were never asked. Before this component the denial only
 * reached a `permission_review` SSE with no consumer, so from the user's chair
 * a reviewer blocking work looked identical to the model deciding not to
 * bother â?the feature was auditable in logs but invisible in the product.
 *
 * The label is chosen from `reviewerSource`, which travels on the event, and is
 * never inferred from shape: æ¨¡åä»£å®¡æç» and ä½ æç»äº are different facts about
 * who is in control, and guessing between them is exactly the failure the
 * three-profile contract exists to prevent.
 */
export function PermissionReviewNotices({ notices }: PermissionReviewNoticesProps) {
  const { t } = useTranslation();
  if (notices.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 px-4 py-1">
      {notices.map((notice) => {
        // Only denials are surfaced today. A classifier APPROVAL has no
        // upstream hook (see buildSdkReviewerDenial), so an "approved" notice
        // could only ever come from the rule engine â?which is routine, and
        // narrating every routine allow would bury the denials that matter.
        if (!isDenyingState(notice.state)) return null;

        const sourceLabel =
          notice.reviewerSource === 'sdk-reviewer'
            ? t('permission.deniedByReviewer' as TranslationKey)
            : notice.reviewerSource === 'user'
              ? t('permission.deniedByUser' as TranslationKey)
              : t('permission.deniedByRules' as TranslationKey);

        return (
          <div
            key={notice.id}
            className="flex items-start gap-2 rounded-md border border-status-warning-foreground/20 bg-status-warning-muted/40 px-2.5 py-1.5"
          >
            <BuckyballIcon
              name="permission"
              size={12}
              className="mt-0.5 shrink-0 text-status-warning-foreground"
              aria-hidden
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[11px] font-medium leading-tight text-status-warning-foreground">
                {sourceLabel}
              </span>
              <span className="text-[11px] leading-tight text-muted-foreground break-all">
                {notice.toolName}
                {/* Already redacted server-side by redactReviewReason â?this
                    renders it, it does not sanitise it. */}
                {notice.reason ? ` â?${notice.reason}` : ''}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
