"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SpinnerGap, CheckCircle, Warning } from "@/components/ui/icon";
import { CodePilotIcon } from "@/components/ui/semantic-icon";
import { SaveButton } from "@/components/ui/save-button";
import { useTranslation } from "@/hooks/useTranslation";
import { SettingsCard } from "@/components/patterns/SettingsCard";
import { FieldRow } from "@/components/patterns/FieldRow";
import { StatusBanner } from "@/components/patterns/StatusBanner";

interface FeishuBridgeSettings {
  bridge_feishu_app_id: string;
  bridge_feishu_app_secret: string;
  bridge_feishu_domain: string;
  bridge_feishu_allow_from: string;
  bridge_feishu_dm_policy: string;
  bridge_feishu_thread_session: string;
  bridge_feishu_group_policy: string;
  bridge_feishu_group_allow_from: string;
  bridge_feishu_require_mention: string;
}

const DEFAULT_SETTINGS: FeishuBridgeSettings = {
  bridge_feishu_app_id: "",
  bridge_feishu_app_secret: "",
  bridge_feishu_domain: "feishu",
  bridge_feishu_allow_from: "",
  bridge_feishu_dm_policy: "open",
  bridge_feishu_thread_session: "false",
  bridge_feishu_group_policy: "open",
  bridge_feishu_group_allow_from: "",
  bridge_feishu_require_mention: "false",
};

export function FeishuBridgeSection() {
  // ── Credentials state ──
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [domain, setDomain] = useState("feishu");
  const [credentialsSaving, setCredentialsSaving] = useState(false);
  const [credentialsDirty, setCredentialsDirty] = useState(false);
  const savedCredentials = useRef({ appId: "", appSecret: "", domain: "feishu" });

  // ── Access & Behavior state ──
  const [allowFrom, setAllowFrom] = useState("");
  const [dmPolicy, setDmPolicy] = useState("open");
  const [threadSession, setThreadSession] = useState(false);
  const [groupPolicy, setGroupPolicy] = useState("open");
  const [groupAllowFrom, setGroupAllowFrom] = useState("");
  const [requireMention, setRequireMention] = useState(false);
  const [behaviorSaving, setBehaviorSaving] = useState(false);
  const [behaviorDirty, setBehaviorDirty] = useState(false);
  const savedBehavior = useRef({
    allowFrom: "", dmPolicy: "open", threadSession: false,
    groupPolicy: "open", groupAllowFrom: "", requireMention: false,
  });

  // ── Verify state ──
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const { t } = useTranslation();

  // ── Quick Create state ──
  const [registering, setRegistering] = useState(false);
  const [regStatus, setRegStatus] = useState<{ variant: 'success' | 'warning' | 'error'; message: string } | null>(null);
  const regPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const regSessionIdRef = useRef<string | null>(null);
  const regAbortRef = useRef<AbortController | null>(null);
  // Bumps on every cancel / completion so in-flight polls from a previous run
  // can detect they are stale and bail out instead of mutating UI state.
  const regRunIdRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (regPollRef.current) { clearTimeout(regPollRef.current); regPollRef.current = null; }
    if (regAbortRef.current) { regAbortRef.current.abort(); regAbortRef.current = null; }
    regRunIdRef.current += 1;
  }, []);

  // ── Dirty tracking ──
  useEffect(() => {
    const s = savedCredentials.current;
    setCredentialsDirty(
      appId !== s.appId || appSecret !== s.appSecret || domain !== s.domain
    );
  }, [appId, appSecret, domain]);

  useEffect(() => {
    const s = savedBehavior.current;
    setBehaviorDirty(
      allowFrom !== s.allowFrom ||
      dmPolicy !== s.dmPolicy ||
      threadSession !== s.threadSession ||
      groupPolicy !== s.groupPolicy ||
      groupAllowFrom !== s.groupAllowFrom ||
      requireMention !== s.requireMention
    );
  }, [allowFrom, dmPolicy, threadSession, groupPolicy, groupAllowFrom, requireMention]);

  // ── Fetch ──
  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/feishu");
      if (res.ok) {
        const data = await res.json();
        const s = { ...DEFAULT_SETTINGS, ...data.settings };
        setAppId(s.bridge_feishu_app_id);
        setAppSecret(s.bridge_feishu_app_secret);
        setDomain(s.bridge_feishu_domain || "feishu");
        setAllowFrom(s.bridge_feishu_allow_from);
        setDmPolicy(s.bridge_feishu_dm_policy || "open");
        setThreadSession(s.bridge_feishu_thread_session === "true");
        setGroupPolicy(s.bridge_feishu_group_policy || "open");
        setGroupAllowFrom(s.bridge_feishu_group_allow_from);
        setRequireMention(s.bridge_feishu_require_mention === "true");

        // Snapshot as "saved" baseline
        savedCredentials.current = {
          appId: s.bridge_feishu_app_id,
          appSecret: s.bridge_feishu_app_secret,
          domain: s.bridge_feishu_domain || "feishu",
        };
        savedBehavior.current = {
          allowFrom: s.bridge_feishu_allow_from,
          dmPolicy: s.bridge_feishu_dm_policy || "open",
          threadSession: s.bridge_feishu_thread_session === "true",
          groupPolicy: s.bridge_feishu_group_policy || "open",
          groupAllowFrom: s.bridge_feishu_group_allow_from,
          requireMention: s.bridge_feishu_require_mention === "true",
        };
        setCredentialsDirty(false);
        setBehaviorDirty(false);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // ── Quick Create handlers (must be after fetchSettings) ──
  const handleQuickCreate = useCallback(async () => {
    setRegistering(true);
    setRegStatus(null);
    setVerifyResult(null);
    try {
      const res = await fetch('/api/bridge/feishu/register/start', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.session_id) {
        setRegStatus({ variant: 'error', message: data.error || t('feishu.createFailed') });
        setRegistering(false);
        return;
      }
      regSessionIdRef.current = data.session_id;
      // Take a fresh run id and abort controller for this session
      regRunIdRef.current += 1;
      const myRunId = regRunIdRef.current;
      const abortCtrl = new AbortController();
      regAbortRef.current = abortCtrl;
      window.open(data.verification_url, '_blank');

      // Adaptive polling — respects slow_down from server
      let pollInterval = 5000;
      const isStale = () => myRunId !== regRunIdRef.current || abortCtrl.signal.aborted;
      const schedulePoll = () => {
        if (isStale()) return;
        regPollRef.current = setTimeout(pollFn, pollInterval);
      };
      const pollFn = async () => {
        if (isStale()) return;
        try {
          const pr = await fetch('/api/bridge/feishu/register/poll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: data.session_id }),
            signal: abortCtrl.signal,
          });
          // If the user cancelled while we were awaiting, bail out without mutating state.
          if (isStale()) return;
          // Non-2xx: server error (including "Session not found" after cancel).
          // Do NOT fall through to schedulePoll — treat as terminal for this run.
          if (!pr.ok) {
            if (isStale()) return;
            stopPolling();
            regSessionIdRef.current = null;
            setRegistering(false);
            setRegStatus({ variant: 'error', message: t('feishu.createFailed') });
            return;
          }
          const pd = await pr.json();
          if (isStale()) return;

          if (pd.status === 'completed') {
            stopPolling();
            regSessionIdRef.current = null;
            setRegistering(false);
            if (pd.verify_error) {
              setRegStatus({ variant: 'warning', message: `${t('feishu.bindingVerifyFailed')}: ${pd.verify_error}` });
            } else if (pd.bridge_restart_error) {
              setRegStatus({ variant: 'warning', message: `${t('feishu.bindingRestartFailed')}: ${pd.bridge_restart_error}` });
            } else {
              setRegStatus({
                variant: 'success',
                message: pd.bot_name
                  ? t('feishu.createSuccess', { botName: pd.bot_name })
                  : t('feishu.createSuccessGeneric'),
              });
            }
            fetchSettings();
          } else if (pd.status === 'failed' || pd.status === 'expired') {
            stopPolling();
            regSessionIdRef.current = null;
            setRegistering(false);
            const errorCodeMap: Record<string, string> = {
              timeout: t('feishu.createExpired'),
              user_denied: t('feishu.errorUserDenied'),
              empty_credentials: t('feishu.errorEmptyCredentials'),
              lark_empty_credentials: t('feishu.errorLarkEmptyCredentials'),
            };
            const message = (pd.error_code && errorCodeMap[pd.error_code])
              || pd.error_detail
              || t('feishu.createFailed');
            setRegStatus({ variant: 'error', message });
          } else if (pd.status === 'waiting') {
            if (pd.interval_ms) pollInterval = pd.interval_ms;
            schedulePoll();
          } else {
            // Unknown status — treat as terminal error to avoid a hidden retry loop
            stopPolling();
            regSessionIdRef.current = null;
            setRegistering(false);
            setRegStatus({ variant: 'error', message: t('feishu.createFailed') });
          }
        } catch (err) {
          // AbortError from user cancel — bail silently
          if ((err as { name?: string })?.name === 'AbortError' || isStale()) return;
          // True network error — retry with current interval
          schedulePoll();
        }
      };
      pollFn();
    } catch {
      setRegistering(false);
      setRegStatus({ variant: 'error', message: t('feishu.createFailed') });
    }
  }, [t, fetchSettings, stopPolling]);

  const handleCancelCreate = useCallback(() => {
    stopPolling();
    setRegistering(false);
    setRegStatus(null);
    // Also cancel on server so a late browser confirmation won't
    // silently complete and create an orphan app binding.
    const sid = regSessionIdRef.current;
    regSessionIdRef.current = null;
    if (sid) {
      fetch('/api/bridge/feishu/register/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid }),
      }).catch(() => { /* best-effort */ });
    }
  }, [stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // ── Save helpers ──
  const saveToApi = async (updates: Partial<FeishuBridgeSettings>) => {
    const res = await fetch("/api/settings/feishu", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: updates }),
    });
    return res.ok;
  };

  const handleSaveCredentials = async () => {
    setCredentialsSaving(true);
    try {
      const updates: Partial<FeishuBridgeSettings> = {
        bridge_feishu_app_id: appId,
        bridge_feishu_domain: domain,
      };
      // Three-way secret handling: mask kept = omit / empty = explicit
      // clear / real value = send. Empty case lets the user remove a
      // saved secret via the UI, which the old `if (secret && ...)`
      // gate silently dropped.
      if (appSecret === "") {
        updates.bridge_feishu_app_secret = "";
      } else if (!appSecret.startsWith("***")) {
        updates.bridge_feishu_app_secret = appSecret;
      }
      if (await saveToApi(updates)) {
        savedCredentials.current = { appId, appSecret, domain };
        setCredentialsDirty(false);
      }
    } catch {
      // ignore
    } finally {
      setCredentialsSaving(false);
    }
  };

  const handleSaveBehavior = async () => {
    setBehaviorSaving(true);
    try {
      const ok = await saveToApi({
        bridge_feishu_allow_from: allowFrom,
        bridge_feishu_dm_policy: dmPolicy,
        bridge_feishu_thread_session: threadSession ? "true" : "false",
        bridge_feishu_group_policy: groupPolicy,
        bridge_feishu_group_allow_from: groupAllowFrom,
        bridge_feishu_require_mention: requireMention ? "true" : "false",
      });
      if (ok) {
        savedBehavior.current = {
          allowFrom, dmPolicy, threadSession,
          groupPolicy, groupAllowFrom, requireMention,
        };
        setBehaviorDirty(false);
      }
    } catch {
      // ignore
    } finally {
      setBehaviorSaving(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      if (!appId) {
        setVerifyResult({
          ok: false,
          message: t("feishu.enterCredentialsFirst"),
        });
        return;
      }

      const res = await fetch("/api/settings/feishu/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: appId,
          app_secret: appSecret,
          domain,
        }),
      });
      const data = await res.json();

      if (data.verified) {
        setVerifyResult({
          ok: true,
          message: data.botName
            ? t("feishu.verifiedAs", { name: data.botName })
            : t("feishu.verified"),
        });
      } else {
        setVerifyResult({
          ok: false,
          message: data.error || t("feishu.verifyFailed"),
        });
      }
    } catch {
      setVerifyResult({ ok: false, message: t("feishu.verifyFailed") });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* ── Feishu App Binding ── */}
      <SettingsCard
        title={t("feishu.quickCreate")}
        description={appId ? undefined : t("feishu.quickCreateDesc")}
      >
        {appId ? (
          /* ── Bound state: show app info + rebind option ── */
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <CheckCircle size={18} className="shrink-0 text-status-success-foreground" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{t("feishu.appId")}: <span className="font-mono text-muted-foreground">{appId}</span></div>
                <div className="text-xs text-muted-foreground">
                  {t("feishu.domain")}: {domain === 'lark' ? 'Lark' : t("feishu.domainFeishu")}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={handleQuickCreate} disabled={registering}>
                {t("feishu.rebind")}
              </Button>
            </div>
            {registering && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <SpinnerGap size={14} className="animate-spin" />
                {t("feishu.waitingAuth")}
              </div>
            )}
            {regStatus && (
              <StatusBanner
                variant={regStatus.variant}
                icon={regStatus.variant === 'success'
                  ? <CheckCircle size={16} className="shrink-0" />
                  : <Warning size={16} className="shrink-0" />}
              >
                {regStatus.message}
              </StatusBanner>
            )}
          </div>
        ) : (
          /* ── Unbound state: show create button ── */
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {!registering ? (
                <Button size="sm" onClick={handleQuickCreate}>
                  <CodePilotIcon name="plus" size="sm" aria-hidden />
                  {t("feishu.quickCreateBtn")}
                </Button>
              ) : (
                <>
                  <Button size="sm" variant="outline" onClick={handleCancelCreate}>
                    {t("common.cancel")}
                  </Button>
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <SpinnerGap size={14} className="animate-spin" />
                    {t("feishu.waitingAuth")}
                  </span>
                </>
              )}
            </div>
            {regStatus && (
              <StatusBanner
                variant={regStatus.variant}
                icon={regStatus.variant === 'success'
                  ? <CheckCircle size={16} className="shrink-0" />
                  : <Warning size={16} className="shrink-0" />}
              >
                {regStatus.message}
              </StatusBanner>
            )}
          </div>
        )}
      </SettingsCard>

      {/* ── Manual Config (collapsed) ── */}
      <details className="group">
        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none">
          {t("feishu.manualConfig")}
        </summary>
        <div className="mt-3">
          <SettingsCard
            title={t("feishu.credentials")}
            description={t("feishu.credentialsDesc")}
          >
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  {t("feishu.appId")}
                </label>
                <Input
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                  placeholder="cli_xxxxxxxxxx"
                  className="font-mono text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  {t("feishu.appSecret")}
                </label>
                <Input
                  type="password"
                  value={appSecret}
                  onChange={(e) => setAppSecret(e.target.value)}
                  placeholder="xxxxxxxxxxxxxxxxxxxxxxxx"
                  className="font-mono text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  {t("feishu.domain")}
                </label>
                <Select value={domain} onValueChange={setDomain}>
                  <SelectTrigger className="w-full text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="feishu">{t("feishu.domainFeishu")}</SelectItem>
                    <SelectItem value="lark">{t("feishu.domainLark")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <SaveButton
                dirty={credentialsDirty}
                saving={credentialsSaving}
                onClick={handleSaveCredentials}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={handleVerify}
                disabled={verifying || !appId}
              >
                {verifying ? <SpinnerGap size={14} className="animate-spin mr-1.5" /> : null}
                {t("feishu.verify")}
              </Button>
            </div>
            {verifyResult && (
              <StatusBanner
                variant={verifyResult.ok ? "success" : "error"}
                icon={verifyResult.ok ? <CheckCircle size={16} className="shrink-0" /> : <Warning size={16} className="shrink-0" />}
              >
                {verifyResult.message}
              </StatusBanner>
            )}
          </SettingsCard>
        </div>
      </details>

      {/* ── Access & Behavior ── */}
      <SettingsCard
        title={t("feishu.accessBehavior")}
        description={t("feishu.accessBehaviorDesc")}
      >
        <div className="space-y-4">
          {/* DM Policy */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-foreground block">
              {t("feishu.dmPolicy")}
            </label>
            <Select value={dmPolicy} onValueChange={setDmPolicy}>
              <SelectTrigger className="w-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">
                  {t("feishu.dmPolicyOpen")}
                </SelectItem>
                <SelectItem value="pairing">
                  {t("feishu.dmPolicyPairing")}
                </SelectItem>
                <SelectItem value="allowlist">
                  {t("feishu.dmPolicyAllowlist")}
                </SelectItem>
                <SelectItem value="disabled">
                  {t("feishu.dmPolicyDisabled")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {t("feishu.allowFrom")}
            </label>
            <Input
              value={allowFrom}
              onChange={(e) => setAllowFrom(e.target.value)}
              placeholder="*, ou_xxxxxxxxxx, ou_yyyyyyyyyy"
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {t("feishu.allowFromHint")}
            </p>
          </div>

          <div className="pt-3 space-y-2">
            <label className="text-xs font-semibold text-foreground block">
              {t("feishu.groupPolicy")}
            </label>
            <Select value={groupPolicy} onValueChange={setGroupPolicy}>
              <SelectTrigger className="w-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">
                  {t("feishu.groupPolicyOpen")}
                </SelectItem>
                <SelectItem value="allowlist">
                  {t("feishu.groupPolicyAllowlist")}
                </SelectItem>
                <SelectItem value="disabled">
                  {t("feishu.groupPolicyDisabled")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {groupPolicy === "allowlist" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                {t("feishu.groupAllowFrom")}
              </label>
              <Input
                value={groupAllowFrom}
                onChange={(e) => setGroupAllowFrom(e.target.value)}
                placeholder="oc_xxxxxxxxxx, oc_yyyyyyyyyy"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t("feishu.groupAllowFromHint")}
              </p>
            </div>
          )}

          <div className="pt-3">
            <FieldRow
              label={t("feishu.requireMention")}
              description={t("feishu.requireMentionDesc")}
            >
              <Switch
                checked={requireMention}
                onCheckedChange={setRequireMention}
              />
            </FieldRow>
          </div>

          <div className="pt-3">
            <FieldRow
              label={t("feishu.threadSession")}
              description={t("feishu.threadSessionDesc")}
            >
              <Switch
                checked={threadSession}
                onCheckedChange={setThreadSession}
              />
            </FieldRow>
          </div>
        </div>

        <SaveButton
          dirty={behaviorDirty}
          saving={behaviorSaving}
          onClick={handleSaveBehavior}
        />
      </SettingsCard>

      {/* ── Setup Guide ── */}
      <SettingsCard title={t("feishu.setupGuide")}>
        <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal pl-4">
          <li>{t("feishu.step1")}</li>
          <li>{t("feishu.step2")}</li>
          <li>{t("feishu.step3")}</li>
        </ol>
      </SettingsCard>
    </div>
  );
}
