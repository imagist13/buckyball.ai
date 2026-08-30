/**
 * WeChat accounts list API.
 * GET — returns all accounts (token masked)
 */

import { NextResponse } from 'next/server';
import { listWeixinAccounts } from '@/lib/db';

export async function GET() {
  try {
    const accounts = listWeixinAccounts().map(a => ({
      account_id: a.account_id,
      user_id: a.user_id,
      base_url: a.base_url,
      cdn_base_url: a.cdn_base_url,
      name: a.name,
      enabled: a.enabled === 1,
      last_login_at: a.last_login_at,
      created_at: a.created_at,
      updated_at: a.updated_at,
      // Mask token for security
      has_token: !!(a.token && a.token.length > 0),
    }));
    return NextResponse.json({ accounts });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to list accounts' }, { status: 500 });
  }
}
