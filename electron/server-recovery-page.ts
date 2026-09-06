export type ServerRecoveryPageState =
  | 'recovering'
  | 'blocked'
  | 'failed'
  | 'database'
  | 'database-retryable'
  | 'database-migration'
  | 'database-fresh-start-conflict';

export interface ServerRecoveryPageOptions {
  locale?: string;
  state: ServerRecoveryPageState;
  attempt?: number;
  reasonCode?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Build a self-contained error surface that does not depend on Next.js. */
export function buildServerRecoveryHtml(options: ServerRecoveryPageOptions): string {
  const zh = (options.locale ?? '').toLowerCase().startsWith('zh');
  const copy = zh
    ? {
        title: options.state === 'recovering' ? 'CodePilot 正在恢复' : 'CodePilot 需要你的操作',
        recovering: '内部服务意外退出，正在安全模式下恢复。当前任务可能已中断。',
        blocked: '无法确认旧的 Codex 进程是否已完全退出。为避免重复进程或数据损坏，自动恢复已停止；请点击「退出应用」，清理残留的 Codex 进程（不确定时重启电脑），然后再手动重新打开应用。',
        failed: '内部服务连续恢复失败，已停止自动重试。',
        database: '数据库完整性检查未通过，CodePilot 已在正常启动前停止。原数据库没有被自动删除或覆盖；如权限与磁盘允许，DB、WAL、SHM 已保存到时间戳备份。你可以打开备份目录导出或手工恢复，也可以在再次完整备份后明确选择新建空数据库。',
        databaseBackupUnavailable: '数据库完整性检查未通过，但这次未能创建可验证的恢复备份。原数据库没有被自动删除或覆盖。请先检查数据目录权限与磁盘空间，再用「备份并新建空数据库」重新尝试；CodePilot 只会在完整备份校验成功后继续。',
        'database-retryable': '数据库暂时被其他进程、系统安全软件或权限状态阻塞；这不代表完整性检查失败，也没有提供新建空库入口。请关闭可能占用数据库的进程后重试或重启应用。',
        databaseRetryablePersistent: '数据库未被判定为损坏，但当前访问失败可能持续存在。请检查数据目录权限、磁盘空间与安全软件拦截，修正后重试；不会提供新建空库入口。',
        'database-migration': '数据库 schema 迁移或启动恢复代码失败；现有数据没有被判定为损坏，也没有自动创建恢复备份。请复制诊断、更新 CodePilot 后重试，不要通过新建空库规避产品故障。',
        'database-fresh-start-conflict': '上次确认新建空数据库后，当前数据库文件又出现了。它可能是你手工恢复的数据，也可能是中断后留下的文件；CodePilot 没有自动删除它。请选择保留当前数据库，或在重新校验上次完整备份后继续新建空库。',
        retry: '再试一次',
        restart: '重启应用',
        quit: '退出应用',
        copy: '复制诊断摘要',
        copied: '诊断摘要已复制',
        attempt: '恢复尝试',
        openBackups: '打开备份目录',
        startFresh: '备份并新建空数据库',
        keepRestored: '保留当前数据库',
        continueFresh: '校验备份并继续空库',
        actionFailed: '操作未完成；请先复制诊断并手工恢复。',
      }
    : {
        title: options.state === 'recovering' ? 'CodePilot is recovering' : 'CodePilot needs your help',
        recovering: 'The internal service exited unexpectedly. Recovery is running in safe mode. The current task may have been interrupted.',
        blocked: 'CodePilot cannot prove that the old Codex process tree has exited. Automatic recovery stopped to avoid duplicate owners. Quit the app, clean up any remaining Codex process (or restart the computer if unsure), then reopen CodePilot manually.',
        failed: 'The internal service failed repeatedly, so automatic retries have stopped.',
        database: 'The database integrity check failed, so CodePilot stopped before normal startup. The original database was not automatically deleted or replaced. When permissions and disk space allowed, the DB, WAL and SHM were saved in a timestamped backup. Open that folder to export or restore manually, or explicitly start with an empty database after another verified backup.',
        databaseBackupUnavailable: 'The database integrity check failed, but this attempt could not create a verified recovery backup. The original database was not deleted or replaced. Check data-folder permissions and disk space, then use “Back up and start fresh” to retry; CodePilot continues only after verifying a complete backup.',
        'database-retryable': 'The database is temporarily blocked by another process, security software, or an access condition. This is not proof of integrity failure, and starting an empty database is not offered. Close anything using the database, then retry or restart the app.',
        databaseRetryablePersistent: 'The database was not declared corrupt, but the access failure may persist. Check data-folder permissions, disk space, and security-software blocks, then retry. Starting an empty database is not offered.',
        'database-migration': 'Database schema migration or startup-recovery code failed. Existing data was not declared corrupt and no recovery backup is claimed. Copy diagnostics, update CodePilot, and retry; do not bypass a product fault by starting empty.',
        'database-fresh-start-conflict': 'Database files appeared after the last confirmation to start empty. They may be a manual restore or interrupted cleanup, so CodePilot did not delete them. Keep the current database, or continue empty only after the prior complete backup is re-verified.',
        retry: 'Try again',
        restart: 'Restart app',
        quit: 'Quit app',
        copy: 'Copy diagnostics',
        copied: 'Diagnostics copied',
        attempt: 'Recovery attempt',
        openBackups: 'Open backup folder',
        startFresh: 'Back up and start fresh',
        keepRestored: 'Keep current database',
        continueFresh: 'Verify backup and continue empty',
        actionFailed: 'The action did not complete. Copy diagnostics and recover manually.',
      };
  const [databaseReason = '', preservation = ''] = (options.reasonCode ?? '').split(':');
  const backupAvailable = options.state === 'database'
    && (preservation === 'complete' || preservation === 'partial');
  const detail = options.state === 'database' && !backupAvailable
    ? copy.databaseBackupUnavailable
    : options.state === 'database-retryable' && databaseReason !== 'database_busy'
      ? copy.databaseRetryablePersistent
      : copy[options.state];
  const attempt = options.attempt && options.attempt > 0
    ? `<p class="meta">${copy.attempt} ${options.attempt}/3</p>`
    : '';
  const reasonCode = options.reasonCode
    ? `<p class="code">${escapeHtml(options.reasonCode)}</p>`
    : '';
  const retryButton = ['failed', 'database-retryable', 'database-migration'].includes(options.state)
    ? `<button id="retry" class="secondary">${copy.retry}</button>`
    : '';
  // The blocked state means the descendant registry cannot prove single
  // ownership, and the registry does not survive a relaunch. A one-click
  // relaunch would boot a fresh Main with an empty registry that may spawn a
  // second Codex app-server over the same CODEX_HOME while the old tree is
  // still alive — exactly the state this page exists to prevent. Blocked
  // therefore offers plain quit only; the user cleans up (or reboots) and
  // reopens the app manually.
  const primaryButton = options.state === 'blocked'
    ? `<button id="quit">${copy.quit}</button>`
    : `<button id="restart">${copy.restart}</button>`;
  const actions = options.state === 'database'
    ? `${backupAvailable ? `<button id="open-backups">${copy.openBackups}</button>` : ''}<button id="start-fresh" class="secondary">${copy.startFresh}</button><button id="quit" class="secondary">${copy.quit}</button>`
    : options.state === 'database-fresh-start-conflict'
      ? `<button id="keep-restored">${copy.keepRestored}</button><button id="continue-fresh" class="secondary">${copy.continueFresh}</button><button id="quit" class="secondary">${copy.quit}</button>`
    : options.state === 'database-retryable' || options.state === 'database-migration'
      ? `${retryButton}${primaryButton}<button id="quit" class="secondary">${copy.quit}</button>`
    : `${retryButton}${primaryButton}`;

  return `<!DOCTYPE html>
<html lang="${zh ? 'zh-CN' : 'en'}">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    *{box-sizing:border-box}body{margin:0;height:100vh;display:grid;place-items:center;background:#111;color:#eee;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-app-region:drag}.card{width:min(520px,calc(100vw - 48px));padding:32px;border:1px solid #333;border-radius:16px;background:#1a1a1a;box-shadow:0 16px 60px #0008}.badge{display:inline-block;margin-bottom:18px;padding:5px 9px;border-radius:999px;background:#2b2112;color:#f4b860;font-size:12px}h1{margin:0 0 12px;font-size:24px}p{margin:0 0 12px;line-height:1.6;color:#bbb}.meta,.code{font-size:12px;color:#777}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:24px;-webkit-app-region:no-drag}button{border:0;border-radius:9px;padding:10px 14px;background:#f1f1f1;color:#111;font-weight:600;cursor:pointer}.secondary{background:#303030;color:#eee}.status{min-height:20px;margin-top:12px;font-size:12px;color:#8dc891;-webkit-app-region:no-drag}
  </style>
</head>
<body>
  <main class="card">
    <div class="badge">Recovery safe mode</div>
    <h1>${copy.title}</h1>
    <p>${detail}</p>
    ${attempt}${reasonCode}
    <div class="actions">${actions}<button id="copy" class="secondary">${copy.copy}</button></div>
    <div id="status" class="status" role="status"></div>
  </main>
  <script>
    const api = window.electronAPI && window.electronAPI.serverRecovery;
    const status = document.getElementById('status');
    ${options.state === 'database'
      ? `${backupAvailable
        ? `document.getElementById('open-backups').addEventListener('click', async () => { if (!api || !await api.openDatabaseBackups()) status.textContent = ${JSON.stringify(copy.actionFailed)}; });`
        : ''}
         document.getElementById('start-fresh').addEventListener('click', async () => { if (!api || !await api.startFreshDatabase()) status.textContent = ${JSON.stringify(copy.actionFailed)}; });
         document.getElementById('quit').addEventListener('click', () => api && api.quitApp());`
      : options.state === 'database-fresh-start-conflict'
        ? `document.getElementById('keep-restored').addEventListener('click', async () => { if (!api || !await api.keepRestoredDatabase()) status.textContent = ${JSON.stringify(copy.actionFailed)}; });
           document.getElementById('continue-fresh').addEventListener('click', async () => { if (!api || !await api.continueFreshDatabase()) status.textContent = ${JSON.stringify(copy.actionFailed)}; });
           document.getElementById('quit').addEventListener('click', () => api && api.quitApp());`
      : options.state === 'blocked'
        ? "document.getElementById('quit').addEventListener('click', () => api && api.quitApp());"
        : `${options.state === 'database-retryable' || options.state === 'database-migration'
          ? "document.getElementById('quit').addEventListener('click', () => api && api.quitApp());"
          : ''}
           document.getElementById('restart').addEventListener('click', () => api && api.restartApp());`}
    document.getElementById('retry')?.addEventListener('click', () => api && api.retry());
    document.getElementById('copy').addEventListener('click', async () => {
      if (api && await api.copyDiagnostics()) status.textContent = ${JSON.stringify(copy.copied)};
    });
  </script>
</body>
</html>`;
}

export function buildServerRecoveryDataUrl(options: ServerRecoveryPageOptions): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(buildServerRecoveryHtml(options))}`;
}
