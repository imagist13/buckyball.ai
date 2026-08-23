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
  const isZh = t('nav.chats') === 'å¯¹è¯';

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
            {isZh ? 'æ°åè½ï¼ç¬ç« Agent å¼æ + OpenAI æ¯æ' : 'New: Independent Agent Engine + OpenAI Support'}
          </DialogTitle>
          <DialogDescription>
            {isZh ? 'æ¬æ¬¡æ´æ°å¸¦æ¥äºåºå±æ¶æåæ? : 'This update includes architectural changes'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            {isZh
              ? <>å¦éé®é¢è¯·å° <a href="https://github.com/op7418/CodePilot/issues" target="_blank" rel="noopener noreferrer" className="underline font-medium">GitHub Issues</a> åé¦ã?/>
              : <>Report issues on <a href="https://github.com/op7418/CodePilot/issues" target="_blank" rel="noopener noreferrer" className="underline font-medium">GitHub Issues</a>.</>
            }
          </div>

          {isZh ? (
            <>
              <p>CodePilot ç°å¨å¯ä»¥è±ç¦» Claude Code CLI ç¬ç«è¿è¡äºã?/p>
              <div className="space-y-2 text-muted-foreground">
                <p><span className="text-foreground font-medium">AI SDK å¼æ</span> â?æ éå®è£ CLIï¼æ¯æææå·²éç½®çæå¡å</p>
                <p><span className="text-foreground font-medium">Claude Code å¼æ</span> â?éè¿ CLI é©±å¨ï¼è·å¾å®æ´çå½ä»¤è¡è½å?/p>
              </div>
              <p>åæ¶æ¯æ <span className="font-medium">OpenAI ææç»å½</span>ï¼ChatGPT Plus/Pro ç¨æ·å¯å¨æå¡åè®¾ç½®ä¸­ç»å½åç´æ¥ä½¿ç?GPT-5.5 ç­æ¨¡åã?/p>
            </>
          ) : (
            <>
              <p>buckyball.ai can now run independently without the Claude Code CLI.</p>
              <div className="space-y-2 text-muted-foreground">
                <p><span className="text-foreground font-medium">AI SDK engine</span> â?no CLI needed, works with all configured providers</p>
                <p><span className="text-foreground font-medium">Claude Code engine</span> â?driven by CLI for full command-line capabilities</p>
              </div>
              <p>Also supports <span className="font-medium">OpenAI OAuth login</span> â?ChatGPT Plus/Pro users can sign in under Providers to use GPT-5.5 and more.</p>
            </>
          )}
        </div>

        <DialogFooter className="gap-3">
          <Button variant="outline" size="sm" onClick={handleGoToSettings}>
            {isZh ? 'åå¾è®¾ç½®' : 'Go to Settings'}
          </Button>
          <Button size="sm" onClick={handleDismiss}>
            {isZh ? 'ç¥éäº? : 'Got it'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
