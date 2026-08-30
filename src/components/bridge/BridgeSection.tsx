"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SpinnerGap, CheckCircle, Warning, TelegramLogo, ChatTeardrop, GameController, ChatsCircle } from "@/components/ui/icon";
import { CodePilotIcon } from "@/components/ui/semantic-icon";
import { useTranslation } from "@/hooks/useTranslation";
import { useBridgeStatus } from "@/hooks/useBridgeStatus";
import { showToast } from "@/hooks/useToast";
import { SettingsCard } from "@/components/patterns/SettingsCard";
import { FieldRow } from "@/components/patterns/FieldRow";
import { StatusBanner } from "@/components/patterns/StatusBanner";
import type { ChatSession, ProviderModelGroup } from "@/types";

interface BridgeSettings {
  remote_bridge_enabled: string;
  bridge_telegram_enabled: string;
  bridge_feishu_enabled: string;
  bridge_discord_enabled: string;
  bridge_qq_enabled: string;
  bridge_weixin_enabled: string;
  bridge_auto_start: string;
  bridge_default_work_dir: string;
  bridge_default_model: string;
  bridge_default_provider_id: string;
}

const DEFAULT_SETTINGS: BridgeSettings = {
  remote_bridge_enabled: "",
  bridge_telegram_enabled: "",
  bridge_feishu_enabled: "",
  bridge_discord_enabled: "",
  bridge_qq_enabled: "",
  bridge_weixin_enabled: "",
  bridge_auto_start: "",
  bridge_default_work_dir: "",
  bridge_default_model: "",
  bridge_default_provider_id: "",
};

export function BridgeSection() {
  const [settings, setSettings] = useState<BridgeSettings>(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [workDir, setWorkDir] = useState("");
  const [model, setModel] = useState("");
  const [providerGroups, setProviderGroups] = useState<ProviderModelGroup[]>([]);
  // Recent project paths (distinct working_directory across chat
  // sessions, latest activity first) — same data source the Assistant
  // workspace picker uses. Lets users pick a known project for the
  // bridge default without retyping the path.
  const [recentPaths, setRecentPaths] = useState<string[]>([]);
  const { bridgeStatus, starting, stopping, startBridge, stopBridge } = useBridgeStatus();
  const { t } = useTranslation();

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/bridge/settings");
      if (res.ok) {
        const data = await res.json();
        const s = { ...DEFAULT_SETTINGS, ...data.settings };
        setSettings(s);
        setWorkDir(s.bridge_default_work_dir);
        // Build composite value for Select: "provider_id::model"
        let composite = "";
        if (s.bridge_default_provider_id && s.bridge_default_model) {
          composite = `${s.bridge_default_provider_id}::${s.bridge_default_model}`;
        } else if (s.bridge_default_model) {
          composite = s.bridge_default_model;
        }
        setModel(composite);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchRecentPaths = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/sessions");
      if (res.ok) {
        const data = await res.json();
        const sessions: ChatSession[] = data.sessions || [];
        const seen = new Set<string>();
        const ordered: string[] = [];
        for (const s of [...sessions].sort((a, b) =>
          (b.updated_at || "").localeCompare(a.updated_at || ""),
        )) {
          const wd = s.working_directory?.trim();
          if (!wd || seen.has(wd)) continue;
          seen.add(wd);
          ordered.push(wd);
        }
        setRecentPaths(ordered);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch("/api/providers/models");
      if (res.ok) {
        const data = await res.json();
        if (data.groups && data.groups.length > 0) {
          setProviderGroups(data.groups);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    fetchModels();
    fetchRecentPaths();
  }, [fetchSettings, fetchModels, fetchRecentPaths]);

  const saveSettings = async (
    updates: Partial<BridgeSettings>,
  ): Promise<boolean> => {
    setSaving(true);
    try {
      const res = await fetch("/api/bridge/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: updates }),
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, ...updates }));
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = (checked: boolean) => {
    saveSettings({ remote_bridge_enabled: checked ? "true" : "" });
  };

  const handleToggleTelegram = (checked: boolean) => {
    saveSettings({ bridge_telegram_enabled: checked ? "true" : "" });
  };

  const handleToggleFeishu = (checked: boolean) => {
    saveSettings({ bridge_feishu_enabled: checked ? "true" : "" });
  };

  const handleToggleDiscord = (checked: boolean) => {
    saveSettings({ bridge_discord_enabled: checked ? "true" : "" });
  };

  const handleToggleQQ = (checked: boolean) => {
    saveSettings({ bridge_qq_enabled: checked ? "true" : "" });
  };

  const handleToggleWeixin = (checked: boolean) => {
    saveSettings({ bridge_weixin_enabled: checked ? "true" : "" });
  };

  // Defaults card is auto-save with debounce + latest-wins. Both
  // dimensions need protection:
  //   1. Sequencing — quick workDir-then-model edits could race so the
  //      older PUT lands second and overwrites the newer model. We
  //      coalesce via a single pending {workDir, model} ref so only
  //      the latest pair ever fires.
  //   2. Half-typed fallback — when `providerGroups` is empty the
  //      model field is a plain Input; without debounce every
  //      keystroke would PUT (`g` → `gl` → `glm`), persisting
  //      half-typed model names. 400ms debounce collapses those into
  //      one save of the final value.
  const pendingDefaultsRef = useRef<{ workDir: string; model: string } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drain the pending pair into a PUT immediately. `keepalive: true`
  // is the meaningful bit: it lets the browser finish the request even
  // when this fires from an unmount cleanup that's part of a
  // page-navigation (without it, the in-flight fetch is cancelled and
  // the user's last edit silently disappears). We don't await it for
  // the same reason — the calling context may be tearing down.
  const flushPendingDefaults = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const target = pendingDefaultsRef.current;
    pendingDefaultsRef.current = null;
    if (!target) return;
    const parts = target.model.split("::");
    const providerId = parts.length === 2 ? parts[0] : "";
    const modelValue = parts.length === 2 ? parts[1] : target.model;
    void fetch("/api/bridge/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          bridge_default_work_dir: target.workDir,
          bridge_default_model: modelValue,
          bridge_default_provider_id: providerId,
        },
      }),
      keepalive: true,
    }).catch(() => { /* page may be unloading; nothing actionable */ });
  };

  const schedulePersistDefaults = (nextWorkDir: string, nextModel: string) => {
    pendingDefaultsRef.current = { workDir: nextWorkDir, model: nextModel };
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const target = pendingDefaultsRef.current;
      pendingDefaultsRef.current = null;
      debounceRef.current = null;
      if (!target) return;
      const parts = target.model.split("::");
      const providerId = parts.length === 2 ? parts[0] : "";
      const modelValue = parts.length === 2 ? parts[1] : target.model;
      void saveSettings({
        bridge_default_work_dir: target.workDir,
        bridge_default_model: modelValue,
        bridge_default_provider_id: providerId,
      });
    }, 400);
  };

  // Flush any pending debounced save on unmount so a value the user
  // just picked (Select / folder dialog / Input keystroke) doesn't get
  // silently dropped when they immediately switch settings tab. The
  // flush uses keepalive: true so the PUT survives the unmount even if
  // it coincides with a route change.
  useEffect(() => () => {
    flushPendingDefaults();
    // flushPendingDefaults is a stable closure over refs/setters; the
    // empty dep array intentionally captures the mount-time function.
    // (flushPendingDefaults is stable — eslint needs no suppression here.)
  }, []);

  const handleWorkDirChange = (next: string) => {
    setWorkDir(next);
    schedulePersistDefaults(next, model);
  };

  const handleModelChange = (next: string) => {
    setModel(next);
    schedulePersistDefaults(workDir, next);
  };

  const handleBrowseFolder = async () => {
    try {
      const api = (window as unknown as Record<string, unknown>).electronAPI as
        | { dialog: { openFolder: (opts?: { defaultPath?: string; title?: string }) => Promise<{ canceled: boolean; filePaths: string[] }> } }
        | undefined;
      if (api?.dialog?.openFolder) {
        const result = await api.dialog.openFolder({
          defaultPath: workDir || undefined,
          title: t("bridge.defaultWorkDir"),
        });
        if (!result.canceled && result.filePaths[0]) {
          handleWorkDirChange(result.filePaths[0]);
        }
      }
    } catch {
      // Not in Electron or dialog unavailable
    }
  };

  const handleToggleAutoStart = (checked: boolean) => {
    saveSettings({ bridge_auto_start: checked ? "true" : "" });
  };

  const handleStartBridge = async () => {
    const reason = await startBridge();
    if (reason) {
      const reasonMessages: Record<string, string> = {
        bridge_not_enabled: t("bridge.errorNotEnabled"),
        no_channels_enabled: t("bridge.errorNoChannels"),
        no_adapters_started: t("bridge.errorNoAdapters"),
        network_error: t("bridge.errorNetwork"),
      };
      const message = reason.startsWith("adapter_config_invalid:")
        ? t("bridge.errorAdapterConfig")
        : reasonMessages[reason] ?? reason;
      showToast({ type: "error", message });
    }
  };

  const isEnabled = settings.remote_bridge_enabled === "true";
  const isTelegramEnabled = settings.bridge_telegram_enabled === "true";
  const isFeishuEnabled = settings.bridge_feishu_enabled === "true";
  const isDiscordEnabled = settings.bridge_discord_enabled === "true";
  const isQQEnabled = settings.bridge_qq_enabled === "true";
  const isWeixinEnabled = settings.bridge_weixin_enabled === "true";
  const isAutoStart = settings.bridge_auto_start === "true";
  const isRunning = bridgeStatus?.running ?? false;
  const adapterCount = bridgeStatus?.adapters?.length ?? 0;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Enable/Disable Master Toggle */}
      <SettingsCard className={isEnabled ? "border-primary/50 bg-primary/5" : undefined}>
        <FieldRow
          label={t("bridge.title")}
          description={t("bridge.description")}
        >
          <Switch
            checked={isEnabled}
            onCheckedChange={handleToggleEnabled}
            disabled={saving}
          />
        </FieldRow>
        {/* Two-state banner: distinguish "enabled in config" from
            "service is actually running". The previous single-message
            banner conflated the two and made users assume external
            channels were already usable just because the master
            switch was on. (2026-05-05 P2 fix.) */}
        {isEnabled && !isRunning && (
          <StatusBanner variant="warning">
            <Warning size={14} className="shrink-0" />
            {t("bridge.enabledNotRunningHint")}
          </StatusBanner>
        )}
        {isEnabled && isRunning && (
          <StatusBanner variant="info" className="bg-primary/10 text-primary">
            <span className="h-2 w-2 shrink-0 rounded-full bg-primary inline-block mr-1" />
            {t("bridge.activeHint")}
          </StatusBanner>
        )}
      </SettingsCard>

      {/* Bridge Status + Start/Stop */}
      {isEnabled && (
        <SettingsCard>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium">{t("bridge.status")}</h2>
              <p className="text-xs text-muted-foreground">
                {isRunning
                  ? t("bridge.activeBindings", { count: String(adapterCount) })
                  : t("bridge.noBindings")}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  isRunning
                    ? "bg-status-success-muted text-status-success-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                <span
                  className={`size-1.5 rounded-full ${
                    isRunning ? "bg-status-success-foreground" : "bg-muted-foreground"
                  }`}
                />
                {isRunning
                  ? t("bridge.statusConnected")
                  : t("bridge.statusDisconnected")}
              </span>
              {isRunning ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={stopBridge}
                  disabled={stopping}
                >
                  {stopping ? (
                    <SpinnerGap
                      size={14}
                      className="animate-spin mr-1.5"
                    />
                  ) : null}
                  {stopping ? t("bridge.stopping") : t("bridge.stop")}
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={handleStartBridge}
                  disabled={starting}
                >
                  {starting ? (
                    <SpinnerGap size={14} className="animate-spin" />
                  ) : (
                    <CodePilotIcon name="play" size="sm" aria-hidden />
                  )}
                  {starting ? t("bridge.starting") : t("bridge.start")}
                </Button>
              )}
            </div>
          </div>
        </SettingsCard>
      )}

      {/* Channel Toggles */}
      {isEnabled && (
        <SettingsCard
          title={t("bridge.channels")}
          description={t("bridge.channelsDesc")}
        >
          {/* All 6 toggles use the inset-divider sub-card pattern from
              `docs/design.md` § Sub-card so the rows share a single
              container with built-in dividers — replaces 5 hand-rolled
              `flex justify-between` rows that had inconsistent
              `pt-3`-based spacing. */}
          <div className="rounded-md bg-muted/40 -mx-1">
            <div className="px-3.5 divide-y divide-border/50">
              <ChannelToggleRow
                icon={<TelegramLogo size={16} className="text-muted-foreground" />}
                title={t("bridge.telegramChannel")}
                description={t("bridge.telegramChannelDesc")}
                checked={isTelegramEnabled}
                onCheckedChange={handleToggleTelegram}
                disabled={saving}
              />
              <ChannelToggleRow
                icon={<ChatTeardrop size={16} className="text-muted-foreground" />}
                title={t("bridge.feishuChannel")}
                description={t("bridge.feishuChannelDesc")}
                checked={isFeishuEnabled}
                onCheckedChange={handleToggleFeishu}
                disabled={saving}
              />
              <ChannelToggleRow
                icon={<GameController size={16} className="text-muted-foreground" />}
                title={t("bridge.discordChannel")}
                description={t("bridge.discordChannelDesc")}
                checked={isDiscordEnabled}
                onCheckedChange={handleToggleDiscord}
                disabled={saving}
              />
              <ChannelToggleRow
                icon={<ChatsCircle size={16} className="text-muted-foreground" />}
                title={t("bridge.qqChannel")}
                description={t("bridge.qqChannelDesc")}
                checked={isQQEnabled}
                onCheckedChange={handleToggleQQ}
                disabled={saving}
              />
              <ChannelToggleRow
                icon={<ChatTeardrop size={16} className="text-muted-foreground" />}
                title={t("bridge.weixinChannel")}
                description={t("bridge.weixinChannelDesc")}
                checked={isWeixinEnabled}
                onCheckedChange={handleToggleWeixin}
                disabled={saving}
              />
              <ChannelToggleRow
                title={t("bridge.autoStart")}
                description={t("bridge.autoStartDesc")}
                checked={isAutoStart}
                onCheckedChange={handleToggleAutoStart}
                disabled={saving}
              />
            </div>
          </div>
        </SettingsCard>
      )}

      {/* Adapter Status */}
      {isEnabled && isRunning && adapterCount > 0 && (
        <SettingsCard
          title={t("bridge.adapters")}
          description={t("bridge.adaptersDesc")}
        >
          <div className="space-y-2">
            {bridgeStatus?.adapters.map((adapter) => (
              <div
                key={adapter.channelType}
                className="rounded-md border border-border/50 bg-muted/40 px-3 py-2 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium capitalize">
                    {adapter.channelType}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      adapter.running
                        ? "bg-status-success-muted text-status-success-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <span
                      className={`size-1.5 rounded-full ${
                        adapter.running ? "bg-status-success-foreground" : "bg-muted-foreground"
                      }`}
                    />
                    {adapter.running
                      ? t("bridge.adapterRunning")
                      : t("bridge.adapterStopped")}
                  </span>
                </div>
                {adapter.lastMessageAt && (
                  <p className="text-xs text-muted-foreground">
                    {t("bridge.adapterLastMessage")}: {new Date(adapter.lastMessageAt).toLocaleString()}
                  </p>
                )}
                {adapter.error && (
                  <p className="text-xs text-status-error-foreground">
                    {t("bridge.adapterLastError")}: {adapter.error}
                  </p>
                )}
              </div>
            ))}
          </div>
        </SettingsCard>
      )}

      {/* Default Settings — auto-save: changes to workDir / model
          immediately PUT /api/bridge/settings, so no Save button. The
          workDir Select pulls from recent project paths (distinct
          working_directory across chat sessions); "选择文件夹" stays
          for paths that aren't in the recent list yet. */}
      {isEnabled && (
        <SettingsCard
          title={t("bridge.defaults")}
          description={t("bridge.defaultsDesc")}
        >
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                {t("bridge.defaultWorkDir")}
              </label>
              <div className="flex gap-2">
                <Select value={workDir} onValueChange={handleWorkDirChange} disabled={saving}>
                  <SelectTrigger className="flex-1 text-sm font-mono">
                    <SelectValue placeholder="/path/to/project" />
                  </SelectTrigger>
                  <SelectContent>
                    {(() => {
                      const opts = workDir && !recentPaths.includes(workDir)
                        ? [workDir, ...recentPaths]
                        : recentPaths;
                      if (opts.length === 0) {
                        return (
                          <div className="px-2 py-1.5 text-xs text-muted-foreground">
                            {t("bridge.browse")}
                          </div>
                        );
                      }
                      return opts.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ));
                    })()}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleBrowseFolder}
                  className="shrink-0"
                  disabled={saving}
                >
                  {t("bridge.browse")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t("bridge.defaultWorkDirHint")}
              </p>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                {t("bridge.defaultModel")}
              </label>
              {providerGroups.length > 0 ? (
                <Select value={model} onValueChange={handleModelChange} disabled={saving}>
                  <SelectTrigger className="w-full text-sm font-normal">
                    <SelectValue placeholder={t("bridge.defaultModelHint")} />
                  </SelectTrigger>
                  <SelectContent>
                    {providerGroups.map((group) => (
                      <SelectGroup key={group.provider_id}>
                        <SelectLabel>{group.provider_name}</SelectLabel>
                        {group.models.map((m) => (
                          <SelectItem
                            key={`${group.provider_id}::${m.value}`}
                            value={`${group.provider_id}::${m.value}`}
                          >
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={model}
                  onChange={(e) => handleModelChange(e.target.value)}
                  placeholder="sonnet"
                  className="font-mono text-sm"
                  disabled={saving}
                />
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {t("bridge.defaultModelHint")}
              </p>
            </div>
          </div>
        </SettingsCard>
      )}
    </div>
  );
}

/**
 * Single channel/auto-start toggle row inside the channels card. Matches
 * the inset-divider sub-card row pattern from `docs/design.md` § Sub-card
 * — `py-2.5 flex items-center justify-between`. Icon is optional (the
 * auto-start row at the bottom doesn't have one).
 */
function ChannelToggleRow({
  icon,
  title,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  icon?: React.ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {icon}
        <div className="min-w-0">
          <p className="text-sm">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </div>
  );
}
