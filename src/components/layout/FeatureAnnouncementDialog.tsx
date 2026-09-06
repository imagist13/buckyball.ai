'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { ANNOUNCEMENT_KEY } from './feature-announcement-key';

export function FeatureAnnouncementDialog() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { t } = useTranslation();
  const isZh = t('nav.chats') === '对话';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Check both localStorage (fast) and DB (persistent across Electron restarts)
    if (localStorage.getItem(ANNOUNCEMENT_KEY)) return;
    // Check DB settings for dismiss state + setup completion in one call
    Promise.all([
      fetch('/api/settings/app').then(r => r.ok ? r.json() : null),
      fetch('/api/setup').then(r => r.ok ? r.json() : null),
    ]).then(([appData, setupData]) => {
      // Already dismissed (persisted in DB)
      if (appData?.settings?.[ANNOUNCEMENT_KEY]) {
        localStorage.setItem(ANNOUNCEMENT_KEY, '1'); // sync to localStorage for fast check
        return;
      }
      // Only show to users who finished setup
      if (setupData?.completed) {
        setTimeout(() => setOpen(true), 800);
      }
    }).catch(() => {});
  }, []);

  const handleDismiss = () => {
    setOpen(false);
    localStorage.setItem(ANNOUNCEMENT_KEY, '1');
    // Persist to DB so it survives Electron restarts / localStorage clearing
    fetch('/api/settings/app', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { [ANNOUNCEMENT_KEY]: 'true' } }),
    }).catch(() => {});
  };

  const handleGoToSettings = () => {
    handleDismiss();
    router.push('/settings/runtime');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleDismiss(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isZh ? '新功能：独立 Agent 引擎 + OpenAI 支持' : 'New: Independent Agent Engine + OpenAI Support'}
          </DialogTitle>
          <DialogDescription>
            {isZh ? '本次更新带来了底层架构变更' : 'This update includes architectural changes'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            {isZh
              ? <>如遇问题请到 <a href="https://github.com/op7418/CodePilot/issues" target="_blank" rel="noopener noreferrer" className="underline font-medium">GitHub Issues</a> 反馈。</>
              : <>Report issues on <a href="https://github.com/op7418/CodePilot/issues" target="_blank" rel="noopener noreferrer" className="underline font-medium">GitHub Issues</a>.</>
            }
          </div>

          {isZh ? (
            <>
              <p>CodePilot 现在可以脱离 Claude Code CLI 独立运行了。</p>
              <div className="space-y-2 text-muted-foreground">
                <p><span className="text-foreground font-medium">AI SDK 引擎</span> — 无需安装 CLI，支持所有已配置的服务商</p>
                <p><span className="text-foreground font-medium">Claude Code 引擎</span> — 通过 CLI 驱动，获得完整的命令行能力</p>
              </div>
              <p>同时支持 <span className="font-medium">OpenAI 授权登录</span>，ChatGPT Plus/Pro 用户可在服务商设置中登录后直接使用 GPT-5.5 等模型。</p>
            </>
          ) : (
            <>
              <p>CodePilot can now run independently without the Claude Code CLI.</p>
              <div className="space-y-2 text-muted-foreground">
                <p><span className="text-foreground font-medium">AI SDK engine</span> — no CLI needed, works with all configured providers</p>
                <p><span className="text-foreground font-medium">Claude Code engine</span> — driven by CLI for full command-line capabilities</p>
              </div>
              <p>Also supports <span className="font-medium">OpenAI OAuth login</span> — ChatGPT Plus/Pro users can sign in under Providers to use GPT-5.5 and more.</p>
            </>
          )}
        </div>

        <DialogFooter className="gap-3">
          <Button variant="outline" size="sm" onClick={handleGoToSettings}>
            {isZh ? '前往设置' : 'Go to Settings'}
          </Button>
          <Button size="sm" onClick={handleDismiss}>
            {isZh ? '知道了' : 'Got it'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
