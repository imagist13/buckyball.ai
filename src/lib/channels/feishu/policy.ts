/**
 * Feishu access control and group policy.
 */

import type { FeishuConfig } from './types';

/**
 * Check if a user is authorized based on the current config.
 *
 * DM policy logic:
 * - disabled â†?false
 * - open â†?allowFrom must include '*' or user's open_id
 * - allowlist â†?allowFrom must include user's open_id
 * - pairing â†?always true (pairing handled elsewhere)
 *
 * Group chat logic (chatId starts with 'oc_'):
 * - groupPolicy === 'disabled' â†?false
 * - groupPolicy === 'allowlist' â†?groupAllowFrom must include chatId
 * - groupPolicy === 'open' â†?true
 */
export function isUserAuthorized(
  config: FeishuConfig,
  userId: string,
  chatId: string,
): boolean {
  // Group chat check
  if (chatId.startsWith('oc_')) {
    if (config.groupPolicy === 'disabled') return false;
    if (config.groupPolicy === 'allowlist') {
      if (!config.groupAllowFrom.includes(chatId)) return false;
    }
    // groupPolicy === 'open' â†?allowed
    return true;
  }

  // DM policy check
  if (config.dmPolicy === 'disabled') return false;
  if (config.dmPolicy === 'pairing') return true;

  if (config.dmPolicy === 'open') {
    if (config.allowFrom.length === 0) return true;
    return config.allowFrom.includes('*') || config.allowFrom.includes(userId);
  }

  if (config.dmPolicy === 'allowlist') {
    return config.allowFrom.includes(userId);
  }

  return false;
}
