'use client';

/**
 * BbdevSettings — bbdev 连接配置页面
 *
 * 让用户设置 buckyball 仓库根目录、当前 chip、远程模式等。
 * 保存后：
 *   1. SettingsMap `bbdev_connection` 写入
 *   2. bbContextStore 更新（供三 Runtime 注入层读取）
 *   3. bbdev SKILL.md 重写 / 重新注册
 *
 * 数据来源（语义契约）：
 *   - GET /api/bbdev/config → parseBbdevConnectionConfig() → 真实值
 *   - 未保存时显示 defaultBbdevConnectionConfig()，不显示假 0 / placeholder
 *   - repoRoot 校验：服务端 fs.existsSync 失败 → 400，不阻塞 UI（前端预校验）
 *
 * 反假数据：
 *   - "Save" 按钮未点 → 显示"未保存修改"
 *   - "Detect default" 真实调 API 探测（不会显示假路径）
 */

import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  SaveButton,
} from '@/components/ui/save-button';
import {
  CheckCircle,
  SpinnerGap,
  Warning,
  XCircle,
} from '@/components/ui/icon';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';

interface BbdevConfig {
  mode: 'local' | 'remote';
  repoRoot: string;
  mcpScriptPath?: string;
  chipName: string;
  balldomain?: string;
  remoteUrl?: string;
  remoteToken?: string;
  autoStartLocal: boolean;
}

type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; skillRefreshed: boolean }
  | { kind: 'error'; message: string };

export function BbdevSettings() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<BbdevConfig | null>(null);
  const [draft, setDraft] = useState<BbdevConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });
  const [detectHint, setDetectHint] = useState<string | null>(null);

  // 初始加载
  useEffect(() => {
    let cancelled = false;
    fetch('/api/bbdev/config')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data?.config) return;
        setConfig(data.config);
        setDraft(data.config);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const dirty = JSON.stringify(config) !== JSON.stringify(draft);

  const update = useCallback((patch: Partial<BbdevConfig>) => {
    setDraft(prev => prev ? { ...prev, ...patch } : prev);
    setStatus({ kind: 'idle' });
  }, []);

  const save = useCallback(async () => {
    if (!draft) return;
    setStatus({ kind: 'saving' });
    try {
      const res = await fetch('/api/bbdev/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus({ kind: 'error', message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      setConfig(data.config);
      setDraft(data.config);
      setStatus({ kind: 'saved', skillRefreshed: data.skillRefreshed });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [draft]);

  const detectDefault = useCallback(async () => {
    try {
      const res = await fetch('/api/bbdev/detect', { cache: 'no-store' });
      const data = await res.json();
      if (data.repoRoot) {
        update({ repoRoot: data.repoRoot });
        setDetectHint(null);
      } else {
        setDetectHint(t('bbdev.settings.detectNone' as TranslationKey));
      }
    } catch (err) {
      setDetectHint(err instanceof Error ? err.message : String(err));
    }
  }, [t, update]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
        <SpinnerGap size={14} className="animate-spin" />
        {t('bbdev.panel.loading' as TranslationKey)}
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="rounded border border-status-error-foreground/40 bg-status-error-foreground/10 p-4 text-sm text-status-error-foreground">
        <XCircle size={14} className="mr-1 inline" weight="fill" />
        {t('bbdev.panel.noData' as TranslationKey)}
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 max-w-2xl">
      <header>
        <h2 className="text-lg font-semibold">
          {t('bbdev.settings.title' as TranslationKey)}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('bbdev.settings.subtitle' as TranslationKey)}
        </p>
      </header>

      {/* Mode */}
      <FieldRow label={t('bbdev.settings.modeLabel' as TranslationKey)}>
        <Select
          value={draft.mode}
          onValueChange={v => update({ mode: v as 'local' | 'remote' })}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local">{t('bbdev.settings.modeLocal' as TranslationKey)}</SelectItem>
            <SelectItem value="remote">{t('bbdev.settings.modeRemote' as TranslationKey)}</SelectItem>
          </SelectContent>
        </Select>
      </FieldRow>

      {/* repoRoot */}
      <FieldRow
        label={t('bbdev.settings.repoRootLabel' as TranslationKey)}
        hint={t('bbdev.settings.repoRootHint' as TranslationKey)}
      >
        <div className="flex gap-2">
          <Input
            value={draft.repoRoot}
            onChange={e => update({ repoRoot: e.target.value })}
            placeholder="/path/to/buckyball"
            className="flex-1"
          />
          <Button variant="outline" size="sm" onClick={detectDefault}>
            {t('bbdev.settings.detectCta' as TranslationKey)}
          </Button>
        </div>
        {detectHint && (
          <p className="mt-1 text-xs text-muted-foreground">{detectHint}</p>
        )}
      </FieldRow>

      {/* MCP script path */}
      <FieldRow
        label={t('bbdev.settings.mcpScriptLabel' as TranslationKey)}
        hint={t('bbdev.settings.mcpScriptHint' as TranslationKey)}
      >
        <Input
          value={draft.mcpScriptPath ?? ''}
          onChange={e => update({ mcpScriptPath: e.target.value || undefined })}
          placeholder="scripts/claude/run_mcp_server.sh"
          className="font-mono"
        />
      </FieldRow>

      {/* chip */}
      <FieldRow
        label={t('bbdev.settings.chipLabel' as TranslationKey)}
        hint={t('bbdev.settings.chipHint' as TranslationKey)}
      >
        <Input
          value={draft.chipName}
          onChange={e => update({ chipName: e.target.value })}
          className="w-32 font-mono"
        />
      </FieldRow>

      {/* balldomain */}
      <FieldRow
        label={t('bbdev.settings.balldomainLabel' as TranslationKey)}
        hint={t('bbdev.settings.balldomainHint' as TranslationKey)}
      >
        <Input
          value={draft.balldomain ?? ''}
          onChange={e => update({ balldomain: e.target.value || undefined })}
          placeholder="(optional)"
          className="w-48 font-mono"
        />
      </FieldRow>

      {/* Remote */}
      {draft.mode === 'remote' && (
        <>
          <FieldRow label={t('bbdev.settings.remoteUrlLabel' as TranslationKey)}>
            <Input
              value={draft.remoteUrl ?? ''}
              onChange={e => update({ remoteUrl: e.target.value || undefined })}
              placeholder="https://bbdev.example.com/sse"
              className="font-mono"
            />
          </FieldRow>
          <FieldRow label={t('bbdev.settings.remoteTokenLabel' as TranslationKey)}>
            <Input
              type="password"
              value={draft.remoteToken ?? ''}
              onChange={e => update({ remoteToken: e.target.value || undefined })}
              placeholder="Bearer token"
            />
          </FieldRow>
        </>
      )}

      {/* Auto start */}
      <FieldRow label={t('bbdev.settings.autoStartLabel' as TranslationKey)}>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={draft.autoStartLocal}
            onCheckedChange={checked => update({ autoStartLocal: checked })}
          />
          <span>{t('bbdev.settings.autoStartLabel' as TranslationKey)}</span>
        </label>
      </FieldRow>

      {/* Save row */}
      <div className="flex items-center gap-3 pt-2 border-t border-border">
        <SaveButton
          dirty={dirty}
          saving={status.kind === 'saving'}
          onClick={save}
          savingLabel={t('common.saving' as TranslationKey)}
          savedLabel={t('common.saved' as TranslationKey)}
          label={t('bbdev.settings.saveCta' as TranslationKey)}
        />
        {status.kind === 'saved' && (
          <span className="inline-flex items-center gap-1 text-xs text-status-success-foreground">
            <CheckCircle size={12} weight="fill" />
            {status.skillRefreshed
              ? t('bbdev.settings.saveSuccess' as TranslationKey)
              : t('bbdev.settings.saveSkillSkipped' as TranslationKey)}
          </span>
        )}
        {status.kind === 'error' && (
          <span className="inline-flex items-center gap-1 text-xs text-status-error-foreground">
            <Warning size={12} weight="fill" />
            {status.message}
          </span>
        )}
      </div>
    </div>
  );
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
