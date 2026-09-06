/**
 * Single WeChat account operations.
 * PATCH — enable/disable account
 * DELETE — remove account
 */

import { NextResponse } from 'next/server';
import { getWeixinAccount, setWeixinAccountEnabled, deleteWeixinAccount } from '@/lib/db';
import { getStatus, restart } from '@/lib/bridge/bridge-manager';

function isBenignRestartReason(reason: string): boolean {
  if (reason === 'no_channels_enabled') {
    return true;
  }
  if (!reason.startsWith('adapter_config_invalid: ')) {
    return false;
  }
  const errors = reason
    .slice('adapter_config_invalid: '.length)
    .split('; ')
    .map(item => item.trim())
    .filter(Boolean);
  return errors.length > 0 && errors.every(error =>
    error.startsWith('weixin: No enabled WeChat accounts')
    || error.startsWith('weixin: No WeChat accounts have valid tokens')
  );
}

/** Restart bridge if running so worker pool reflects account changes. */
async function restartIfRunning(): Promise<string | null> {
  if (!getStatus().running) {
    return null;
  }
  try {
    const result = await restart();
    if (result.started || !result.reason || isBenignRestartReason(result.reason)) {
      return null;
    }
    return result.reason;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const { accountId } = await params;
    const account = getWeixinAccount(accountId);
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const body = await request.json();
    if (typeof body.enabled === 'boolean') {
      setWeixinAccountEnabled(accountId, body.enabled);
      const restartError = await restartIfRunning();
      if (restartError) {
        return NextResponse.json(
          { ok: false, error: restartError, account_updated: true },
          { status: 503 },
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to update account' }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const { accountId } = await params;
    const deleted = deleteWeixinAccount(accountId);
    if (!deleted) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }
    const restartError = await restartIfRunning();
    if (restartError) {
      return NextResponse.json(
        { ok: false, error: restartError, account_deleted: true },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 });
  }
}
